using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;
using MohammedLab.ColorVision.Core;
using Brush = System.Windows.Media.Brush;
using Brushes = System.Windows.Media.Brushes;
using Color = System.Windows.Media.Color;

namespace MohammedLab.ColorVision;

public partial class MainWindow : Window
{
    private readonly SettingsStore _store = new();
    private readonly AppConfig _settings;
    private readonly AimEngine _engine;
    private readonly DispatcherTimer _uiTimer;
    private OverlayWindow? _overlay;
    private bool _loading = true;
    private bool _captureHasFrame;
    private XInput.State _latestPhysicalState;

    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr hObject);

    public MainWindow()
    {
        InitializeComponent();
        _settings = _store.Load();
        _engine = new AimEngine(_settings);
        _engine.TelemetryUpdated += Engine_TelemetryUpdated;
        _engine.Faulted += Engine_Faulted;
        _engine.PreviewFrameReady += Engine_PreviewFrameReady;
        PopulateControls();
        LoadSettingsToUi();
        ShowPage(CapturePage, NavCapture);
        RunCheck();

        _uiTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        _uiTimer.Tick += UiTimer_Tick;
        _uiTimer.Start();

        Closed += async (_, _) =>
        {
            _uiTimer.Stop();
            HideOverlay();
            await _engine.StopAsync();
            _engine.Dispose();
        };
    }

    private Brush ResourceBrush(string key) => (Brush)FindResource(key);

    private void PopulateControls()
    {
        CmbMonitor.ItemsSource = ScreenCapture.MonitorNames;
        CmbFps.ItemsSource = AppConfig.CaptureFpsOptions;
        CmbWidth.ItemsSource = AppConfig.ZoneWidths;
        CmbHeight.ItemsSource = AppConfig.ZoneHeights;
        var buttons = Enum.GetValues<PadButton>().Where(x => x != PadButton.None).ToArray();
        CmbAimButton.ItemsSource = buttons;
        CmbFireButton.ItemsSource = buttons;
    }

    private void LoadSettingsToUi()
    {
        _loading = true;
        try
        {
            CmbMonitor.SelectedIndex = Math.Clamp(_settings.ScreenIndex, 0, Math.Max(0, CmbMonitor.Items.Count - 1));
            CmbFps.SelectedItem = _settings.CaptureFps;
            CmbWidth.SelectedItem = _settings.ZoneWidth;
            CmbHeight.SelectedItem = _settings.ZoneHeight;
            ChkNoPreview.IsChecked = _settings.NoPreview;
            ChkHud.IsChecked = _settings.ShowHud;
            CmbDevice.SelectedIndex = (int)_settings.Device;
            CmbAimButton.SelectedItem = _settings.AimButton;
            CmbFireButton.SelectedItem = _settings.FireButton;
            foreach (var item in CmbAimKey.Items.OfType<ComboBoxItem>())
                if (int.TryParse(item.Tag?.ToString(), out var key) && key == _settings.AimKey) { CmbAimKey.SelectedItem = item; break; }
            if (CmbAimKey.SelectedIndex < 0) CmbAimKey.SelectedIndex = 0;
            ChkHold.IsChecked = _settings.HoldToAim;
            ChkAlways.IsChecked = _settings.AlwaysTrack;
            SldStrength.Value = _settings.Strength;
            SldOffset.Value = _settings.AimPointOffsetPx;
            ChkRecoil.IsChecked = _settings.AntiRecoilOn;
            SldRecoil.Value = _settings.AntiRecoil;
            ChkAutoFire.IsChecked = _settings.AutoFire;
            SldTriggerThreshold.Value = _settings.TriggerThreshold;
            ChkSwapTriggers.IsChecked = _settings.SwapTriggers;
            GuideTabs.SelectedIndex = Math.Clamp((int)_settings.GuideGame, 0, 3);
            RefreshUiText();
            UpdateGameTabs();
        }
        finally { _loading = false; }
    }

    private void ReadUiToSettings()
    {
        if (_loading) return;
        _settings.ScreenIndex = Math.Max(0, CmbMonitor.SelectedIndex);
        _settings.CaptureFps = CmbFps.SelectedItem is int fps ? fps : 90;
        _settings.ZoneWidth = CmbWidth.SelectedItem is int width ? width : 400;
        _settings.ZoneHeight = CmbHeight.SelectedItem is int height ? height : 560;
        _settings.NoPreview = ChkNoPreview.IsChecked == true;
        _settings.ShowHud = ChkHud.IsChecked == true;
        _settings.Device = (AimDevice)Math.Clamp(CmbDevice.SelectedIndex, 0, 1);
        if (CmbAimButton.SelectedItem is PadButton aim) _settings.AimButton = aim;
        if (CmbFireButton.SelectedItem is PadButton fire) _settings.FireButton = fire;
        if (CmbAimKey.SelectedItem is ComboBoxItem keyItem && int.TryParse(keyItem.Tag?.ToString(), out var key)) _settings.AimKey = key;
        _settings.HoldToAim = ChkHold.IsChecked == true;
        _settings.AlwaysTrack = ChkAlways.IsChecked == true;
        _settings.Strength = (float)SldStrength.Value;
        _settings.AimPointOffsetPx = (int)Math.Round(SldOffset.Value);
        _settings.AntiRecoilOn = ChkRecoil.IsChecked == true;
        _settings.AntiRecoil = (float)SldRecoil.Value;
        _settings.AutoFire = ChkAutoFire.IsChecked == true;
        _settings.TriggerThreshold = (int)Math.Round(SldTriggerThreshold.Value);
        _settings.SwapTriggers = ChkSwapTriggers.IsChecked == true;
        SettingsStore.Clamp(_settings);
        _store.Save(_settings);
        _engine.ApplyConfig(_settings);
        RefreshUiText();
        UpdateHudVisibility();
    }

    private void RefreshUiText()
    {
        TxtStrength.Text = _settings.Strength.ToString("0.0");
        TxtOffset.Text = $"{_settings.AimPointOffsetPx}px";
        TxtRecoil.Text = _settings.AntiRecoil.ToString("0.0");
        TxtTriggerThreshold.Text = $"{_settings.TriggerThreshold} / 255 ({_settings.TriggerThreshold / 255.0:P0})";
        RecoilRow.IsEnabled = _settings.AntiRecoilOn;
        StatusDevice.Text = $"Device: {_settings.Device}";
        TxtDeviceNote.Text = _settings.Device == AimDevice.Mouse
            ? "Mouse mode uses the selected Aim Key."
            : "Controller mode uses Aim / Fire bindings and the virtual Xbox controller.";
        TxtCaptureSummary.Text = $"Monitor {_settings.ScreenIndex + 1} • {_settings.ZoneWidth}x{_settings.ZoneHeight} • {_settings.CaptureFps} FPS";
        StatTargetFps.Text = _settings.CaptureFps.ToString();

        if (_settings.NoPreview)
        {
            ImgPreview.Source = null;
            ImgPreview.Visibility = Visibility.Collapsed;
            PreviewPlaceholder.Visibility = Visibility.Visible;
            TxtPreviewHint.Text = _engine.Running ? "Preview disabled • Capture is still running" : "Preview disabled";
        }
        else
        {
            ImgPreview.Visibility = Visibility.Visible;
            if (ImgPreview.Source is null)
            {
                PreviewPlaceholder.Visibility = Visibility.Visible;
                TxtPreviewHint.Text = _engine.Running ? "Waiting for first frame…" : "Press START CAPTURE to begin";
            }
        }
    }

    private void SettingChanged(object sender, RoutedEventArgs e) => ReadUiToSettings();

    private async void BtnToggle_Click(object sender, RoutedEventArgs e)
    {
        if (_engine.Running) await StopCaptureAsync();
        else StartCapture();
    }

    private void StartCapture()
    {
        ReadUiToSettings();
        HideError();
        _captureHasFrame = false;
        SetCaptureStatus("Starting…", ResourceBrush("WarningBrush"), "Capture • Starting");
        BtnToggle.Content = "STOP CAPTURE";
        SetCaptureSensitiveEnabled(false);

        if (!_engine.Start())
        {
            SetCaptureSensitiveEnabled(true);
            BtnToggle.Content = "START CAPTURE";
            return;
        }

        StatusText.Text = "Starting capture";
        RefreshUiText();
        UpdateHudVisibility();
    }

    private async Task StopCaptureAsync()
    {
        await _engine.StopAsync();
        _captureHasFrame = false;
        BtnToggle.Content = "START CAPTURE";
        SetCaptureSensitiveEnabled(true);
        SetCaptureStatus("CAPTURE STOPPED", ResourceBrush("DisabledBrush"), "Capture • Stopped");
        PreviewLiveDot.Fill = ResourceBrush("DisabledBrush");
        TxtPreviewLive.Text = "OFFLINE";
        StatusText.Text = "Ready";
        HideOverlay();
        RefreshUiText();
    }

    private async void BtnRetry_Click(object sender, RoutedEventArgs e)
    {
        if (_engine.Running) await StopCaptureAsync();
        StartCapture();
    }

    private void SetCaptureSensitiveEnabled(bool enabled)
    {
        CmbMonitor.IsEnabled = enabled;
        CmbFps.IsEnabled = enabled;
        CmbWidth.IsEnabled = enabled;
        CmbHeight.IsEnabled = enabled;
    }

    private void SetCaptureStatus(string status, Brush brush, string header)
    {
        TxtCaptureState.Text = status;
        CaptureStateDot.Fill = brush;
        HeaderCaptureDot.Fill = brush;
        HeaderCaptureText.Text = header;
    }

    private void Engine_TelemetryUpdated()
    {
        Dispatcher.BeginInvoke(() =>
        {
            if (!_engine.Running) return;
            if (!_captureHasFrame && _engine.FrameCount > 0)
            {
                _captureHasFrame = true;
                SetCaptureStatus("CAPTURING", ResourceBrush("SuccessBrush"), "Capture • Live");
                PreviewLiveDot.Fill = ResourceBrush("SuccessBrush");
                TxtPreviewLive.Text = "LIVE";
                StatusText.Text = "Capturing";
            }

            UpdateCaptureStats();
            if (_overlay is { IsVisible: true }) _overlay.UpdateTarget(_engine.LastDetection, _settings.ZoneWidth, _settings.ZoneHeight);
        }, DispatcherPriority.Background);
    }

    private void Engine_PreviewFrameReady(Bitmap bitmap)
    {
        Dispatcher.BeginInvoke(() =>
        {
            try
            {
                if (_settings.NoPreview || !_engine.Running) return;
                ImgPreview.Source = BitmapToSource(bitmap);
                PreviewPlaceholder.Visibility = Visibility.Collapsed;
                if (!_captureHasFrame)
                {
                    _captureHasFrame = true;
                    SetCaptureStatus("CAPTURING", ResourceBrush("SuccessBrush"), "Capture • Live");
                    PreviewLiveDot.Fill = ResourceBrush("SuccessBrush");
                    TxtPreviewLive.Text = "LIVE";
                }
            }
            finally { bitmap.Dispose(); }
        }, DispatcherPriority.Render);
    }

    private static BitmapSource BitmapToSource(Bitmap bitmap)
    {
        var hBitmap = bitmap.GetHbitmap();
        try
        {
            var source = Imaging.CreateBitmapSourceFromHBitmap(hBitmap, IntPtr.Zero, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            source.Freeze();
            return source;
        }
        finally { DeleteObject(hBitmap); }
    }

    private void UpdateCaptureStats()
    {
        var d = _engine.LastDetection;
        StatFrames.Text = _engine.FrameCount.ToString("N0");
        StatActualFps.Text = _engine.CaptureFps.ToString("0.0");
        StatTargetFps.Text = _settings.CaptureFps.ToString();
        StatGrab.Text = $"{_engine.GrabMs:0.00} ms";
        StatProcessing.Text = $"{d.ProcessingMs:0.00} ms";
        StatDropped.Text = _engine.DroppedFrames.ToString("N0");
        StatCandidates.Text = d.CandidateCount.ToString();
        StatTarget.Text = d.Found ? "TARGET DETECTED" : "NO TARGET";
        StatTarget.Foreground = d.Found ? ResourceBrush("SuccessBrush") : ResourceBrush("MutedBrush");
    }

    private void UiTimer_Tick(object? sender, EventArgs e)
    {
        var connected = XInput.TryGetState(0, out _latestPhysicalState);
        HeaderControllerDot.Fill = connected ? ResourceBrush("SuccessBrush") : ResourceBrush("DisabledBrush");
        HeaderControllerText.Text = connected ? "Controller • Connected" : "Controller • Not connected";
        TxtControllerConnection.Text = connected ? "CONNECTED" : "NOT CONNECTED";
        TxtControllerConnection.Foreground = connected ? ResourceBrush("SuccessBrush") : ResourceBrush("DangerBrush");
        UpdateControllerTester(connected, _latestPhysicalState.Gamepad);

        if (_engine.Running && _engine.LastFrameUtc != default)
        {
            var age = Math.Max(0, (DateTime.UtcNow - _engine.LastFrameUtc).TotalSeconds);
            StatLastFrame.Text = $"Last frame: {age:0.00}s ago";
        }
        else StatLastFrame.Text = "Last frame: —";
    }

    private void UpdateControllerTester(bool connected, XInput.Gamepad g)
    {
        TxtLeftStick.Text = connected ? $"X {g.sThumbLX,6}  /  Y {g.sThumbLY,6}" : "X 0  /  Y 0";
        TxtRightStick.Text = connected ? $"X {g.sThumbRX,6}  /  Y {g.sThumbRY,6}" : "X 0  /  Y 0";
        TxtTriggers.Text = connected ? $"L2 {g.bLeftTrigger / 255.0:P0}  /  R2 {g.bRightTrigger / 255.0:P0}" : "L2 0%  /  R2 0%";

        SetPad(PadL1, connected && g.wButtons.HasFlag(XInput.Buttons.LeftShoulder));
        SetPad(PadR1, connected && g.wButtons.HasFlag(XInput.Buttons.RightShoulder));
        SetPad(PadL2, connected && g.bLeftTrigger >= _settings.TriggerThreshold);
        SetPad(PadR2, connected && g.bRightTrigger >= _settings.TriggerThreshold);
        SetPad(PadL3, connected && g.wButtons.HasFlag(XInput.Buttons.LeftThumb));
        SetPad(PadR3, connected && g.wButtons.HasFlag(XInput.Buttons.RightThumb));
        SetPad(PadCross, connected && g.wButtons.HasFlag(XInput.Buttons.A));
        SetPad(PadCircle, connected && g.wButtons.HasFlag(XInput.Buttons.B));
        SetPad(PadSquare, connected && g.wButtons.HasFlag(XInput.Buttons.X));
        SetPad(PadTriangle, connected && g.wButtons.HasFlag(XInput.Buttons.Y));
        SetPad(PadCreate, connected && g.wButtons.HasFlag(XInput.Buttons.Back));
        SetPad(PadOptions, connected && g.wButtons.HasFlag(XInput.Buttons.Start));
        SetPad(PadUp, connected && g.wButtons.HasFlag(XInput.Buttons.DPadUp));
        SetPad(PadDown, connected && g.wButtons.HasFlag(XInput.Buttons.DPadDown));
        SetPad(PadLeft, connected && g.wButtons.HasFlag(XInput.Buttons.DPadLeft));
        SetPad(PadRight, connected && g.wButtons.HasFlag(XInput.Buttons.DPadRight));
    }

    private void SetPad(Border border, bool pressed)
    {
        border.Background = pressed ? ResourceBrush("AccentBrush") : ResourceBrush("Panel2Brush");
        border.BorderBrush = pressed ? ResourceBrush("AccentHoverBrush") : ResourceBrush("BorderBrush");
        if (border.Child is TextBlock text) text.Foreground = pressed ? new SolidColorBrush(Color.FromRgb(24, 26, 31)) : ResourceBrush("TextBrush");
    }

    private void Engine_Faulted(string text) => Dispatcher.BeginInvoke(async () =>
    {
        ShowError("Capture failed: " + text);
        SetCaptureStatus("CAPTURE ERROR", ResourceBrush("DangerBrush"), "Capture • Error");
        StatusText.Text = "Capture error";
        BtnToggle.Content = "START CAPTURE";
        SetCaptureSensitiveEnabled(true);
        HideOverlay();
        try { await _engine.StopAsync(); } catch { }
    });

    private void ShowError(string text)
    {
        ErrorText.Text = text;
        ErrorBanner.Visibility = Visibility.Visible;
    }

    private void HideError() => ErrorBanner.Visibility = Visibility.Collapsed;

    private void UpdateHudVisibility()
    {
        if (!_engine.Running || !_settings.ShowHud)
        {
            HideOverlay();
            return;
        }

        try
        {
            _overlay ??= new OverlayWindow();
            var region = ScreenCapture.GetRegionBounds(_settings.ZoneWidth, _settings.ZoneHeight, _settings.ScreenIndex);
            _overlay.UpdateRegion(region);
            if (!_overlay.IsVisible) _overlay.Show();
        }
        catch (Exception ex) { ShowError("HUD unavailable: " + ex.Message); }
    }

    private void HideOverlay()
    {
        if (_overlay is null) return;
        try { _overlay.Hide(); } catch { }
    }

    private void BtnRescanController_Click(object sender, RoutedEventArgs e)
    {
        var connected = XInput.TryGetState(0, out _);
        StatusText.Text = connected ? "Controller connected" : "Controller not detected";
        RunCheck();
    }

    private void BtnReplug_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            _engine.ReplugController();
            StatusText.Text = "Controller reconnected";
            HideError();
        }
        catch (Exception ex) { ShowError("Controller reconnect failed: " + ex.Message); }
    }

    private void GameTab_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button b || !int.TryParse(b.Tag?.ToString(), out var value)) return;
        _settings.Game = (GameMode)Math.Clamp(value, 0, 3);
        _store.Save(_settings);
        _engine.ApplyConfig(_settings);
        UpdateGameTabs();
    }

    private void UpdateGameTabs()
    {
        var buttons = new[] { GameBo7, GameBo6, GameMw, GameMw4 };
        for (var i = 0; i < buttons.Length; i++)
        {
            var selected = i == Math.Clamp((int)_settings.Game, 0, 3);
            buttons[i].Background = selected ? ResourceBrush("AccentBrush") : ResourceBrush("Panel2Brush");
            buttons[i].Foreground = selected ? new SolidColorBrush(Color.FromRgb(24, 26, 31)) : ResourceBrush("TextBrush");
            buttons[i].BorderBrush = selected ? ResourceBrush("AccentBrush") : ResourceBrush("BorderBrush");
        }
    }

    private void GuideTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loading || !IsLoaded) return;
        _settings.GuideGame = (GameMode)Math.Clamp(GuideTabs.SelectedIndex, 0, 3);
        _settings.GuideStep = 0;
        _store.Save(_settings);
    }

    private void BtnCheck_Click(object sender, RoutedEventArgs e) => RunCheck();

    private void RunCheck()
    {
        TxtCheckOs.Text = $"✔ Windows: {Environment.OSVersion.Version}";
        TxtCheckRuntime.Text = $"✔ .NET Runtime: {Environment.Version}";

        var openCv = ColorDetector.OpenCvVersion();
        var openCvReady = !openCv.StartsWith("Unavailable", StringComparison.OrdinalIgnoreCase);
        SetCheckText(TxtCheckOpenCv, openCvReady, $"OpenCV: {openCv}");

        var monitorCount = System.Windows.Forms.Screen.AllScreens.Length;
        SetCheckText(TxtCheckMonitors, monitorCount > 0, $"Monitor availability: {monitorCount} detected");

        using (var probe = new ScreenCapture())
        {
            var capture = probe.TryProbe(Math.Clamp(_settings.ScreenIndex, 0, Math.Max(0, monitorCount - 1)));
            SetCheckText(TxtCheckCapture, capture.Ready, "Capture availability: " + capture.Message);
        }

        var physical = XInput.TryGetState(0, out _);
        SetCheckText(TxtCheckPad, physical, physical ? "Controller: Connected" : "Controller: Not detected");

        var vigemInstalled = ServiceExists("ViGEmBus");
        if (!vigemInstalled)
        {
            using var test = new VirtualController();
            vigemInstalled = test.Connect();
        }
        SetCheckText(TxtCheckVigem, vigemInstalled, vigemInstalled ? "ViGEm: Ready" : "ViGEm: Missing / unavailable");

        var hidHide = ServiceExists("HidHide") || HidHideFolderExists();
        SetCheckText(TxtCheckHidHide, hidHide, hidHide ? "HidHide: Ready" : "HidHide: Missing");
    }

    private void SetCheckText(TextBlock block, bool ready, string message)
    {
        block.Text = (ready ? "✔ " : "✖ ") + message;
        block.Foreground = ready ? ResourceBrush("SuccessBrush") : ResourceBrush("DangerBrush");
    }

    private static bool ServiceExists(string name)
    {
        try { using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{name}"); return key is not null; }
        catch { return false; }
    }

    private static bool HidHideFolderExists()
    {
        try
        {
            var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            return Directory.Exists(Path.Combine(pf, "Nefarius Software Solutions", "HidHide"));
        }
        catch { return false; }
    }

    private void BtnInstallVigem_Click(object sender, RoutedEventArgs e) => OpenUrl("https://github.com/nefarius/ViGEmBus/releases/latest");
    private void BtnInstallHidHide_Click(object sender, RoutedEventArgs e) => OpenUrl("https://github.com/nefarius/HidHide/releases/latest");

    private void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { ShowError("Unable to open browser: " + ex.Message); }
    }

    private void NavCapture_Click(object sender, RoutedEventArgs e) => ShowPage(CapturePage, NavCapture);
    private void NavGame_Click(object sender, RoutedEventArgs e) => ShowPage(GamePage, NavGame);
    private void NavGuide_Click(object sender, RoutedEventArgs e) => ShowPage(GuidePage, NavGuide);
    private void NavCheck_Click(object sender, RoutedEventArgs e) { RunCheck(); ShowPage(CheckPage, NavCheck); }

    private void ShowPage(UIElement page, Button selectedNav)
    {
        CapturePage.Visibility = Visibility.Collapsed;
        GamePage.Visibility = Visibility.Collapsed;
        GuidePage.Visibility = Visibility.Collapsed;
        CheckPage.Visibility = Visibility.Collapsed;
        page.Visibility = Visibility.Visible;

        foreach (var nav in new[] { NavCapture, NavGame, NavGuide, NavCheck })
        {
            nav.Background = nav == selectedNav ? ResourceBrush("Panel2Brush") : Brushes.Transparent;
            nav.BorderBrush = nav == selectedNav ? ResourceBrush("BorderBrush") : Brushes.Transparent;
            nav.Foreground = nav == selectedNav ? ResourceBrush("AccentBrush") : ResourceBrush("TextBrush");
        }
    }
}
