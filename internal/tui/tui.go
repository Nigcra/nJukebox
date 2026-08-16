// tui.go
// Terminal interface (Bubble Tea) showing status, library figures and the log
// Version: 2026.08.16

// Package tui provides the terminal interface of the nJukebox server: server
// state, library figures and a scrollable event log, in the same shape as the
// Spherifyer TUI.
package tui

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Colour palette, aligned with the Spherifyer TUI.
var (
	labelStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("#6b7280"))
	valueStyle     = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#e2e8f0"))
	okStyle        = lipgloss.NewStyle().Foreground(lipgloss.Color("#16a34a"))
	warnStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("#d97706"))
	errStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("#dc2626"))
	helpStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("#9ca3af"))
	boxStyle       = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("#374151")).Padding(0, 1)
	accentStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("#1db954")).Bold(true)
	logoStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("#1db954")).Bold(true)
	keyHintStyle   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#e2e8f0"))
	statusBarStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#94a3b8")).Background(lipgloss.Color("#1e293b"))

	tabActiveStyle   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#ffffff")).Background(lipgloss.Color("#1db954")).Padding(0, 1)
	tabInactiveStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#6b7280")).Padding(0, 1)
)

// logoArt is the box-drawing banner in the header, matching the Spherifyer
// logo style. It spells NJUKEBOX.
const logoArt = "╭─╮ ╶─╮ ╷ ╷ │ ╱ ╭─╮ ├─╮ ╭─╮ ╲ ╱\n" +
	"│ │   │ │ │ ├─╴ ├── ├─┤ │ │  ╳ \n" +
	"╵ ╵ ╰─╯ ╰─╯ │ ╲ ╰─╯ ╰─╯ ╰─╯ ╱ ╲"

// Snapshot is everything the TUI shows about the running server. The server
// owns the databases, so it hands over a copy rather than a live handle.
type Snapshot struct {
	Tracks   int64
	Artists  int64
	Albums   int64
	Genres   int64
	Plays    int64
	Duration time.Duration

	Sessions int64

	SpotifyConfigured bool
	SpotifyConnected  bool
	SpotifyExpires    time.Time

	Scanning     bool
	LastScan     time.Time
	LastScanText string
	MusicDir     string

	// Err carries a collection failure so the TUI can show it instead of
	// silently displaying zeroes.
	Err error
}

// Config wires the TUI to the running server.
type Config struct {
	// WebURL is the address to open in a browser, WebAddr and DataAddr are what
	// the two listeners bound to. An empty listener address means it is off.
	WebURL   string
	WebAddr  string
	DataAddr string
	Root     string

	// Stats collects a fresh snapshot; called once per second.
	Stats func() Snapshot

	// Rescan triggers a library scan. May be nil when the data server is off.
	Rescan func()

	// Events is the server log.
	Events <-chan Event

	// Quit is called once when the user leaves the TUI.
	Quit func()
}

type eventMsg Event
type tickMsg time.Time

// tabIndex identifies the active top-level view.
type tabIndex int

const (
	tabDashboard tabIndex = iota
	tabLibrary
	tabLogs
)

var tabNames = []string{"Dashboard", "Library", "Logs"}

type model struct {
	cfg      Config
	started  time.Time
	snap     Snapshot
	logs     []string
	viewport viewport.Model
	ready    bool
	width    int
	height   int
	quitting bool
	tab      tabIndex
}

// New builds the TUI model.
func New(cfg Config) *model {
	m := &model{cfg: cfg, started: time.Now()}
	if cfg.Stats != nil {
		m.snap = cfg.Stats()
	}
	return m
}

// Run starts the TUI and blocks until the user quits.
func (m *model) Run() error {
	p := tea.NewProgram(m, tea.WithAltScreen())
	_, err := p.Run()
	return err
}

func (m *model) Init() tea.Cmd {
	return tea.Batch(waitForEvent(m.cfg.Events), tickCmd())
}

func waitForEvent(events <-chan Event) tea.Cmd {
	if events == nil {
		return nil
	}
	return func() tea.Msg {
		event, ok := <-events
		if !ok {
			return nil
		}
		return eventMsg(event)
	}
}

func tickCmd() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		// Reserve rows for the logo header, blank lines, tab bar, log title,
		// viewport borders, help line and the pinned status bar (Logs layout).
		logHeight := msg.Height - 14
		if logHeight < 3 {
			logHeight = 3
		}
		if !m.ready {
			m.viewport = viewport.New(msg.Width-4, logHeight)
			m.ready = true
		} else {
			m.viewport.Width = msg.Width - 4
			m.viewport.Height = logHeight
		}
		m.viewport.SetContent(strings.Join(m.logs, "\n"))
		m.viewport.GotoBottom()
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c", "esc":
			m.quitting = true
			return m, tea.Quit
		case "right", "tab":
			m.tab = (m.tab + 1) % tabIndex(len(tabNames))
			return m, nil
		case "left", "shift+tab":
			m.tab = (m.tab - 1 + tabIndex(len(tabNames))) % tabIndex(len(tabNames))
			return m, nil
		case "1":
			m.tab = tabDashboard
			return m, nil
		case "2":
			m.tab = tabLibrary
			return m, nil
		case "3":
			m.tab = tabLogs
			return m, nil
		case "r":
			if m.cfg.Rescan != nil {
				m.cfg.Rescan()
				m.appendLog(Event{Time: time.Now(), Level: "", Message: "Library rescan requested ..."})
			}
			return m, nil
		case "o":
			if m.cfg.WebURL != "" {
				openBrowser(m.cfg.WebURL)
			}
			return m, nil
		}

	case eventMsg:
		m.appendLog(Event(msg))
		return m, waitForEvent(m.cfg.Events)

	case tickMsg:
		if m.cfg.Stats != nil {
			m.snap = m.cfg.Stats()
		}
		return m, tickCmd()
	}

	// Only the Logs tab owns the scrollable viewport.
	if m.tab == tabLogs {
		var cmd tea.Cmd
		m.viewport, cmd = m.viewport.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m *model) appendLog(e Event) {
	var style lipgloss.Style
	switch e.Level {
	case "ok":
		style = okStyle
	case "error":
		style = errStyle
	case "warn":
		style = warnStyle
	default:
		style = labelStyle
	}
	line := fmt.Sprintf("%s  %s", helpStyle.Render(e.Time.Format("15:04:05")), style.Render(e.Message))
	m.logs = append(m.logs, line)
	if len(m.logs) > 500 {
		m.logs = m.logs[len(m.logs)-500:]
	}
	if m.ready {
		m.viewport.SetContent(strings.Join(m.logs, "\n"))
		m.viewport.GotoBottom()
	}
}

func (m *model) View() string {
	if m.quitting {
		return "Stopping nJukebox ...\n"
	}
	if !m.ready {
		return "Starting ..."
	}

	var hb strings.Builder
	for _, line := range strings.Split(logoArt, "\n") {
		hb.WriteString(logoStyle.Render(line))
		hb.WriteByte('\n')
	}
	hb.WriteString(helpStyle.Render("Nico's Jukebox"))
	header := hb.String()

	var body string
	switch m.tab {
	case tabLibrary:
		body = m.libraryView()
	case tabLogs:
		body = accentStyle.Render("Event log") + "\n" +
			boxStyle.Width(m.width-2).Render(m.viewport.View())
	default:
		body = m.metricsView() + "\n\n" + m.serverView()
	}

	hint := func(key, label string) string {
		return keyHintStyle.Render(key) + helpStyle.Render(") "+label)
	}
	hints := []string{hint("←/→", "View")}
	if m.cfg.Rescan != nil {
		hints = append(hints, hint("r", "Rescan library"))
	}
	if m.cfg.WebURL != "" {
		hints = append(hints, hint("o", "Open browser"))
	}
	hints = append(hints, hint("q", "Quit"))
	help := strings.Join(hints, helpStyle.Render("   "))

	content := strings.Join([]string{
		header,
		"",
		m.tabBar(),
		"",
		body,
		"",
		help,
	}, "\n")

	// Pin the status bar to the bottom of the terminal.
	h := m.height
	if h <= 0 {
		h = 24
	}
	if lines := strings.Count(content, "\n"); lines < h-2 {
		content += strings.Repeat("\n", h-2-lines)
	}
	return content + "\n" + m.statusBar()
}

// tabBar renders the navigation with the active tab highlighted.
func (m *model) tabBar() string {
	parts := make([]string, 0, len(tabNames))
	for i, name := range tabNames {
		if tabIndex(i) == m.tab {
			parts = append(parts, tabActiveStyle.Render(name))
		} else {
			parts = append(parts, tabInactiveStyle.Render(name))
		}
	}
	return strings.Join(parts, helpStyle.Render(" "))
}

// metricsView renders the library figures as a row of cards.
func (m *model) metricsView() string {
	w := m.width
	if w <= 0 {
		w = 100
	}
	const nCards = 6
	cardW := (w-2)/nCards - 4
	if cardW < 9 {
		cardW = 9
	}
	cardStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#374151")).
		Padding(0, 1).
		Width(cardW).
		MarginRight(1)
	stat := func(title, value string, vs lipgloss.Style) string {
		return cardStyle.Render(labelStyle.Render(title) + "\n" + vs.Bold(true).Render(value))
	}

	spotify, spotifyStyle := "off", labelStyle
	switch {
	case m.snap.SpotifyConnected:
		spotify, spotifyStyle = "linked", okStyle
	case m.snap.SpotifyConfigured:
		spotify, spotifyStyle = "logged out", warnStyle
	}

	return lipgloss.JoinHorizontal(lipgloss.Top,
		stat("Tracks", formatCount(m.snap.Tracks), accentStyle),
		stat("Artists", formatCount(m.snap.Artists), accentStyle),
		stat("Albums", formatCount(m.snap.Albums), accentStyle),
		stat("Playtime", formatDuration(m.snap.Duration), accentStyle),
		stat("Plays", formatCount(m.snap.Plays), accentStyle),
		stat("Spotify", spotify, spotifyStyle),
	)
}

// serverView renders what the two listeners are doing.
func (m *model) serverView() string {
	kv := func(label, value string) string {
		return labelStyle.Render(fmt.Sprintf("%-16s", label)) + value
	}

	state := okStyle.Render("● running")
	if m.snap.Scanning {
		state = warnStyle.Render("● scanning library ...")
	}
	if m.snap.Err != nil {
		state = errStyle.Render("● " + m.snap.Err.Error())
	}

	rows := []string{
		kv("State", state),
		kv("Interface", addressValue(m.cfg.WebAddr, m.cfg.WebURL)),
		kv("Data API", addressValue(m.cfg.DataAddr, "http://"+m.cfg.DataAddr+"/api/")),
		kv("Sessions", valueStyle.Render(fmt.Sprintf("%d", m.snap.Sessions))),
		kv("Directory", valueStyle.Render(m.cfg.Root)),
		kv("Uptime", valueStyle.Render(formatUptime(time.Since(m.started)))),
	}
	return boxStyle.Width(m.width - 2).Render(strings.Join(rows, "\n"))
}

// libraryView renders scanner and library detail.
func (m *model) libraryView() string {
	kv := func(label, value string) string {
		return labelStyle.Render(fmt.Sprintf("%-16s", label)) + value
	}

	scanState := labelStyle.Render("○ idle")
	if m.snap.Scanning {
		scanState = warnStyle.Render("● scanning ...")
	}

	lastScan := "–"
	if m.snap.LastScanText != "" {
		lastScan = m.snap.LastScanText
	}

	spotifyRow := labelStyle.Render("not configured")
	switch {
	case m.snap.SpotifyConnected:
		expiry := "–"
		if !m.snap.SpotifyExpires.IsZero() {
			expiry = m.snap.SpotifyExpires.Format("15:04:05")
		}
		spotifyRow = okStyle.Render("● linked") + labelStyle.Render("  renews "+expiry)
	case m.snap.SpotifyConfigured:
		spotifyRow = warnStyle.Render("● client id set, not logged in")
	}

	// Sections in falling importance. A short terminal drops them from the back
	// rather than pushing the pinned status bar off the bottom, so what stays on
	// an 80x24 console is the scan state and the figures - the paths and the
	// explanation are the parts one can do without.
	sections := [][]string{
		{accentStyle.Render("Music library")},
		{
			kv("Scanner", scanState),
			kv("Last scan", valueStyle.Render(lastScan)),
		},
		{
			kv("Tracks", valueStyle.Render(formatCount(m.snap.Tracks))),
			kv("Artists", valueStyle.Render(formatCount(m.snap.Artists))),
			kv("Albums", valueStyle.Render(formatCount(m.snap.Albums))),
			kv("Genres", valueStyle.Render(formatCount(m.snap.Genres))),
			kv("Playtime", valueStyle.Render(formatDuration(m.snap.Duration))),
		},
		{kv("Spotify", spotifyRow)},
		{
			kv("Folder", valueStyle.Render(m.cfg.Root)),
			kv("Music", valueStyle.Render(m.snap.MusicDir)),
		},
		{
			labelStyle.Render("The scanner indexes on startup and watches the folder while it runs."),
			labelStyle.Render("A track whose file disappeared is dropped only after two scans miss it."),
		},
	}

	return boxStyle.Width(m.width - 2).Render(strings.Join(m.fitSections(sections), "\n"))
}

// fitSections joins sections with a blank line between them, stopping before
// the body grows taller than bodyRows(). A section is taken whole or not at
// all, so a half-rendered block never appears.
func (m *model) fitSections(sections [][]string) []string {
	budget := m.bodyRows()
	rows := make([]string, 0, budget)

	for _, section := range sections {
		needed := len(section)
		if len(rows) > 0 {
			needed++ // the blank separator
		}
		if len(rows)+needed > budget {
			break
		}
		if len(rows) > 0 {
			rows = append(rows, "")
		}
		rows = append(rows, section...)
	}
	return rows
}

// bodyRows is how many text rows a bordered body box may hold before the frame
// grows taller than the terminal and the pinned status bar scrolls away.
//
// The frame around it is fixed: three logo lines plus the subtitle, a blank
// line, the tab bar, a blank line, a blank line above the help, the help itself
// and the status bar - ten rows - and the box adds its own two borders.
func (m *model) bodyRows() int {
	const chrome = 10 + 2
	h := m.height
	if h <= 0 {
		h = 24
	}
	if rows := h - chrome; rows > 1 {
		return rows
	}
	return 1
}

// statusBar renders the one-line bar pinned to the bottom: a coloured run state
// on the left, addresses and figures filling the rest, on a uniform background.
func (m *model) statusBar() string {
	w := m.width
	if w <= 0 {
		w = 80
	}

	stateText, stateColor := "● running", "#16a34a"
	if m.snap.Scanning {
		stateText, stateColor = "● scanning ...", "#d97706"
	}
	if m.snap.Err != nil {
		stateText, stateColor = "● error", "#dc2626"
	}
	stateStyle := lipgloss.NewStyle().Bold(true).
		Foreground(lipgloss.Color(stateColor)).Background(lipgloss.Color("#1e293b"))

	pre := "  "
	mid := fmt.Sprintf("   %s tracks   %s artists   %s albums",
		formatCount(m.snap.Tracks), formatCount(m.snap.Artists), formatCount(m.snap.Albums))

	right := "  "
	if m.cfg.WebURL != "" {
		right = fmt.Sprintf("Web %s   up %s  ", m.cfg.WebURL, formatUptime(time.Since(m.started)))
	}

	pad := w - lipgloss.Width(pre) - lipgloss.Width(stateText) - lipgloss.Width(mid) - lipgloss.Width(right)
	if pad < 1 {
		pad = 1
	}
	return statusBarStyle.Render(pre) +
		stateStyle.Render(stateText) +
		statusBarStyle.Render(mid+strings.Repeat(" ", pad)+right)
}

// addressValue renders a listener address, or a muted "off" when it is empty.
func addressValue(addr, url string) string {
	if addr == "" {
		return labelStyle.Render("off")
	}
	if url != "" {
		return accentStyle.Render(url)
	}
	return valueStyle.Render(addr)
}

// formatCount groups thousands so a large library stays readable.
func formatCount(n int64) string {
	s := fmt.Sprintf("%d", n)
	if n < 0 || len(s) <= 3 {
		return s
	}
	var out []byte
	for i, digit := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ' ')
		}
		out = append(out, digit)
	}
	return string(out)
}

// formatUptime never renders a dash. The server is demonstrably running, so a
// fresh start is "0s" rather than the "unknown" that formatDuration shows for
// figures that have not been collected yet.
func formatUptime(d time.Duration) string {
	if d < time.Second {
		return "0s"
	}
	return formatDuration(d)
}

// formatDuration renders a span as the largest two units that fit.
func formatDuration(d time.Duration) string {
	if d <= 0 {
		return "–"
	}
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60
	seconds := int(d.Seconds()) % 60

	switch {
	case days > 0:
		return fmt.Sprintf("%dd %dh", days, hours)
	case hours > 0:
		return fmt.Sprintf("%dh %dm", hours, minutes)
	case minutes > 0:
		return fmt.Sprintf("%dm %ds", minutes, seconds)
	default:
		return fmt.Sprintf("%ds", seconds)
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
