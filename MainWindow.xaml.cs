using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;
using MohammedLab.ColorVision.Core;
using MohammedLab.ColorVision.Models;
using Brush = System.Windows.Media.Brush;
using Button = System.Windows.Controls.Button;
using WBrushes = System.Windows.Media.Brushes;
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
    private Storyboard? _capturePulse;
    private Storyboard? _toastStoryboard;
    private DispatcherTimer? _settingsToastTimer;
    private DateTime _lastTesterUpdate = DateTime.MinValue;
    private bool _lastControllerConnected;
    private bool _toastShownForRunning;

    private static readonly bool AnimationsAllowed =
        SystemParameters.ClientAreaAnimation && SystemParameters.MinimizeAnimation;

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
        _lastControllerConnected = XInput.TryGetState(0, out _);
        _loadedOnce = true;

        _uiTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        _uiTimer.Tick += UiTimer_Tick;
        _uiTimer.Start();

        Closed += async (_, _) =>
        {
            _uiTimer.Stop();
            _settingsToastTimer?.Stop();
            StopCapturePulse();
            _toastStoryboard?.Stop();
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
            UpdateDeviceSegments();
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
        DebounceSettingsSavedToast();
    }

    private void DebounceSettingsSavedToast()
    {
        // Sliders fire ValueChanged continuously while dragging; only toast once changes settle.
        _settingsToastTimer ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(900) };
        _settingsToastTimer.Stop();
        _settingsToastTimer.Tick -= SettingsToastTimer_Tick;
        _settingsToastTimer.Tick += SettingsToastTimer_Tick;
        _settingsToastTimer.Start();
    }

    private void SettingsToastTimer_Tick(object? sender, EventArgs e)
    {
        _settingsToastTimer?.Stop();
        ShowToast("Settings saved", ResourceBrush("SuccessBrush"));
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
            PreviewOverlay.Visibility = Visibility.Collapsed;
            PreviewPlaceholder.Visibility = Visibility.Visible;
            TxtPreviewHint.Text = _engine.Running ? "Preview disabled • Capture is still running" : "Preview disabled";
        }
        else
        {
            ImgPreview.Visibility = Visibility.Visible;
            if (ImgPreview.Source is null)
            {
                PreviewOverlay.Visibility = Visibility.Collapsed;
                PreviewPlaceholder.Visibility = Visibility.Visible;
                TxtPreviewHint.Text = _engine.Running ? "Waiting for first frame…" : "Start capture to preview the selected region.";
            }
        }
    }

    private void UpdateDeviceSegments()
    {
        var isController = _settings.Device == AimDevice.Controller;
        SetSegment(DeviceMouse, !isController);
        SetSegment(DeviceController, isController);
    }

    private void SetSegment(Button button, bool active)
    {
        button.Background = active ? ResourceBrush("Brush.Accent.Subtle") : WBrushes.Transparent;
        button.Foreground = active ? ResourceBrush("AccentBrush") : ResourceBrush("TextBrush");
        button.BorderBrush = active ? ResourceBrush("Brush.Accent.SubtleBorder") : WBrushes.Transparent;
        button.BorderThickness = new Thickness(1);
    }

    private void DeviceSegment_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button b || !int.TryParse(b.Tag?.ToString(), out var value)) return;
        var device = (AimDevice)Math.Clamp(value, 0, 1);
        if (_settings.Device == device) return;
        _settings.Device = device;
        UpdateDeviceSegments();
        ReadUiToSettings();
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
        _toastShownForRunning = false;
        SetCaptureStatus("Starting…", ResourceBrush("WarningBrush"), "Capture • Starting");
        SetStartStopVisual(running: true);
        SetCaptureSensitiveEnabled(false);

        if (!_engine.Start())
        {
            SetCaptureSensitiveEnabled(true);
            SetStartStopVisual(running: false);
            return;
        }

        StatusText.Text = "Starting capture";
        StatusDot.Fill = ResourceBrush("WarningBrush");
        RefreshUiText();
        UpdateHudVisibility();
    }

    private async Task StopCaptureAsync()
    {
        await _engine.StopAsync();
        _captureHasFrame = false;
        SetStartStopVisual(running: false);
        SetCaptureSensitiveEnabled(true);
        StopCapturePulse();
        SetCaptureStatus("CAPTURE STOPPED", ResourceBrush("Brush.Text.Muted"), "Capture • Stopped");
        PreviewLiveDot.Fill = ResourceBrush("Brush.Text.Muted");
        TxtPreviewLive.Text = "OFFLINE";
        StatusText.Text = "Ready";
        StatusDot.Fill = ResourceBrush("Brush.Text.Muted");
        HideOverlay();
        RefreshUiText();
        ShowToast("Capture stopped", ResourceBrush("Brush.Text.Secondary"));
    }

    private void SetStartStopVisual(bool running)
    {
        BtnToggle.Content = running ? "STOP CAPTURE" : "START CAPTURE";
        BtnToggle.Style = (Style)FindResource(running ? "DangerButton" : "PrimaryButton");
    }

    private void SetCapturingVisual()
    {
        SetCaptureStatus("CAPTURING", ResourceBrush("SuccessBrush"), "Capture • Live");
        PreviewLiveDot.Fill = ResourceBrush("SuccessBrush");
        TxtPreviewLive.Text = "LIVE";
        StatusText.Text = "Capturing";
        StatusDot.Fill = ResourceBrush("SuccessBrush");
        StartCapturePulse();
        if (!_toastShownForRunning)
        {
            _toastShownForRunning = true;
            ShowToast("Capture started", ResourceBrush("SuccessBrush"));
        }
    }

    private void StartCapturePulse()
    {
        if (!AnimationsAllowed) return;
        if (_capturePulse is not null) return;
        var animation = new DoubleAnimation(1.0, 0.35, TimeSpan.FromSeconds(0.9))
        {
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
        };
        var storyboard = new Storyboard();
        storyboard.Children.Add(animation);
        Storyboard.SetTarget(animation, CaptureStateDot);
        Storyboard.SetTargetProperty(animation, new PropertyPath(OpacityProperty));
        _capturePulse = storyboard;
        storyboard.Begin();
    }

    private void StopCapturePulse()
    {
        _capturePulse?.Stop();
        _capturePulse = null;
        CaptureStateDot.Opacity = 1.0;
    }

    private void ShowToast(string message, Brush accent)
    {
        ToastText.Text = message;
        ToastDot.Fill = accent;
        _toastStoryboard?.Stop();
        var fadeIn = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(140)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
        var fadeOut = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(220)) { BeginTime = TimeSpan.FromMilliseconds(2600) };
        var slideIn = new DoubleAnimation(8, 0, TimeSpan.FromMilliseconds(140)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
        var storyboard = new Storyboard { FillBehavior = FillBehavior.Stop };
        storyboard.Children.Add(fadeIn);
        storyboard.Children.Add(fadeOut);
        storyboard.Children.Add(slideIn);
        Storyboard.SetTarget(fadeIn, ToastCard);
        Storyboard.SetTargetProperty(fadeIn, new PropertyPath(OpacityProperty));
        Storyboard.SetTarget(fadeOut, ToastCard);
        Storyboard.SetTargetProperty(fadeOut, new PropertyPath(OpacityProperty));
        Storyboard.SetTarget(slideIn, ToastCard);
        Storyboard.SetTargetProperty(slideIn, new PropertyPath("RenderTransform.Y"));
        storyboard.Completed += (_, _) => { ToastCard.Opacity = 0; ToastShift.Y = 8; };
        _toastStoryboard = storyboard;
        storyboard.Begin();
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
                SetCapturingVisual();
            }
            UpdateCaptureStats();
            UpdatePreviewOverlay(_engine.LastDetection);
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
                    SetCapturingVisual();
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
        StatTarget.Text = d.Found ? "✔ TARGET DETECTED" : "NO TARGET";
        StatTarget.Foreground = d.Found ? ResourceBrush("SuccessBrush") : ResourceBrush("MutedBrush");
    }

    private void UpdatePreviewOverlay(DetectionResult d)
    {
        if (ImgPreview.Source is not BitmapSource { IsFrozen: true } source || PreviewOverlay.ActualWidth <= 0 || PreviewOverlay.ActualHeight <= 0)
        {
            PreviewOverlay.Visibility = Visibility.Collapsed;
            return;
        }

        PreviewOverlay.Visibility = Visibility.Visible;
        var scale = Math.Min(PreviewOverlay.ActualWidth / source.PixelWidth, PreviewOverlay.ActualHeight / source.PixelHeight);
        var offsetX = (PreviewOverlay.ActualWidth - source.PixelWidth * scale) / 2;
        var offsetY = (PreviewOverlay.ActualHeight - source.PixelHeight * scale) / 2;
        var cx = offsetX + source.PixelWidth * scale / 2;
        var cy = offsetY + source.PixelHeight * scale / 2;
        Canvas.SetLeft(PreviewCenterH, cx);
        Canvas.SetTop(PreviewCenterH, cy);
        Canvas.SetLeft(PreviewCenterV, cx);
        Canvas.SetTop(PreviewCenterV, cy);

        if (!d.Found)
        {
            PreviewTargetBox.Visibility = Visibility.Collapsed;
            PreviewTargetDot.Visibility = Visibility.Collapsed;
            return;
        }

        Canvas.SetLeft(PreviewTargetBox, offsetX + d.Bounds.X * scale);
        Canvas.SetTop(PreviewTargetBox, offsetY + d.Bounds.Y * scale);
        PreviewTargetBox.Width = Math.Max(2, d.Bounds.Width * scale);
        PreviewTargetBox.Height = Math.Max(2, d.Bounds.Height * scale);
        Canvas.SetLeft(PreviewTargetDot, offsetX + d.Target.X * scale - 3);
        Canvas.SetTop(PreviewTargetDot, offsetY + d.Target.Y * scale - 3);
        PreviewTargetBox.Visibility = Visibility.Visible;
        PreviewTargetDot.Visibility = Visibility.Visible;
    }

    private void UiTimer_Tick(object? sender, EventArgs e)
    {
        var connected = XInput.TryGetState(0, out _latestPhysicalState);
        HeaderControllerDot.Fill = connected ? ResourceBrush("SuccessBrush") : ResourceBrush("Brush.Text.Muted");
        HeaderControllerText.Text = connected ? "Controller • Connected" : "Controller • Not connected";
        TxtControllerConnection.Text = connected ? "CONNECTED" : "NOT CONNECTED";
        TxtControllerConnection.Foreground = connected ? ResourceBrush("SuccessBrush") : ResourceBrush("DangerBrush");
        ControllerCardDot.Fill = connected ? ResourceBrush("SuccessBrush") : ResourceBrush("DangerBrush");
        UpdateVirtualControllerStatus();

        if (connected != _lastControllerConnected)
        {
            _lastControllerConnected = connected;
            if (_loadedOnce) ShowToast(connected ? "Controller connected" : "Controller disconnected",
                connected ? ResourceBrush("SuccessBrush") : ResourceBrush("WarningBrush"));
        }

        // Throttle tester visuals to 60 Hz max.
        var now = DateTime.UtcNow;
        if ((now - _lastTesterUpdate).TotalMilliseconds >= 16)
        {
            _lastTesterUpdate = now;
            UpdateControllerTester(connected, _latestPhysicalState.Gamepad);
        }

        if (_engine.Running && _engine.LastFrameUtc != default)
        {
            var age = Math.Max(0, (DateTime.UtcNow - _engine.LastFrameUtc).TotalSeconds);
            StatLastFrame.Text = $"Last frame: {age:0.00}s ago";
        }
        else StatLastFrame.Text = "Last frame: —";
    }

    private bool _loadedOnce;
    private string _lastVirtualStatus = "";

    private void UpdateVirtualControllerStatus()
    {
        var status = _engine.VirtualControllerStatus;
        if (string.Equals(status, _lastVirtualStatus, StringComparison.Ordinal)) return;
        _lastVirtualStatus = status;
        var ready = !string.IsNullOrWhiteSpace(status) &&
                    (status.Contains("ready", StringComparison.OrdinalIgnoreCase) || status.Contains("connected", StringComparison.OrdinalIgnoreCase));
        TxtVirtualController.Text = $"Virtual controller: {status}";
        VirtualControllerDot.Fill = ready ? ResourceBrush("SuccessBrush") : ResourceBrush("WarningBrush");
    }

    private void UpdateControllerTester(bool connected, XInput.Gamepad g)
    {
        TxtLeftStick.Text = connected ? $"X {g.sThumbLX,6}  /  Y {g.sThumbLY,6}" : "X 0  /  Y 0";
        TxtRightStick.Text = connected ? $"X {g.sThumbRX,6}  /  Y {g.sThumbRY,6}" : "X 0  /  Y 0";
        var l2 = connected ? g.bLeftTrigger : (byte)0;
        var r2 = connected ? g.bRightTrigger : (byte)0;
        TxtL2.Text = $"{l2 / 255.0:P0}";
        TxtR2.Text = $"{r2 / 255.0:P0}";
        if (L2Bar.Parent is FrameworkElement l2Host) L2Bar.Width = l2Host.ActualWidth * (l2 / 255.0);
        if (R2Bar.Parent is FrameworkElement r2Host) R2Bar.Width = r2Host.ActualWidth * (r2 / 255.0);
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
        border.Background = pressed ? ResourceBrush("AccentBrush") : ResourceBrush("Brush.Raised");
        border.BorderBrush = pressed ? ResourceBrush("AccentHoverBrush") : ResourceBrush("BorderBrush");
        if (border.Child is TextBlock text) text.Foreground = pressed ? new SolidColorBrush(Color.FromRgb(24, 26, 31)) : ResourceBrush("TextBrush");
    }

    private void Engine_Faulted(string text) => Dispatcher.BeginInvoke(async () =>
    {
        ShowError("Capture failed: " + text);
        StopCapturePulse();
        SetCaptureStatus("CAPTURE ERROR", ResourceBrush("DangerBrush"), "Capture • Error");
        StatusText.Text = "Capture error";
        StatusDot.Fill = ResourceBrush("DangerBrush");
        SetStartStopVisual(running: false);
        SetCaptureSensitiveEnabled(true);
        HideOverlay();
        ShowToast("Capture failed", ResourceBrush("DangerBrush"));
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
        if (!_engine.Running || !_settings.ShowHud) { HideOverlay(); return; }
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
        try { _engine.ReplugController(); StatusText.Text = "Controller reconnected"; HideError(); }
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
            SetSegment(buttons[i], selected);
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
        SetCheckRow(ChkOsDot, TxtCheckOsState, true);
        TxtCheckOs.Text = $"Version {Environment.OSVersion.Version}";
        SetCheckRow(ChkRuntimeDot, TxtCheckRuntimeState, true);
        TxtCheckRuntime.Text = $"Version {Environment.Version}";
        var openCv = ColorDetector.OpenCvVersion();
        var openCvReady = !openCv.StartsWith("Unavailable", StringComparison.OrdinalIgnoreCase);
        SetCheckRow(ChkOpenCvDot, TxtCheckOpenCvState, openCvReady);
        TxtCheckOpenCv.Text = openCv;
        var monitorCount = System.Windows.Forms.Screen.AllScreens.Length;
        SetCheckRow(ChkMonitorsDot, TxtCheckMonitorsState, monitorCount > 0);
        TxtCheckMonitors.Text = $"{monitorCount} detected";
        using (var probe = new ScreenCapture())
        {
            var capture = probe.TryProbe(Math.Clamp(_settings.ScreenIndex, 0, Math.Max(0, monitorCount - 1)));
            SetCheckRow(ChkCaptureDot, TxtCheckCaptureState, capture.Ready);
            TxtCheckCapture.Text = capture.Message;
        }
        var physical = XInput.TryGetState(0, out _);
        SetCheckRow(ChkPadDot, TxtCheckPadState, physical);
        TxtCheckPad.Text = physical ? "Connected" : "Not detected";
        var vigemInstalled = ServiceExists("ViGEmBus");
        if (!vigemInstalled) { using var test = new VirtualController(); vigemInstalled = test.Connect(); }
        SetCheckRow(ChkVigemDot, TxtCheckVigemState, vigemInstalled);
        TxtCheckVigem.Text = vigemInstalled ? "Virtual controller driver ready" : "Missing / unavailable";
        var hidHide = ServiceExists("HidHide") || HidHideFolderExists();
        SetCheckRow(ChkHidHideDot, TxtCheckHidHideState, hidHide);
        TxtCheckHidHide.Text = hidHide ? "Ready" : "Missing";
    }

    private void SetCheckRow(System.Windows.Shapes.Ellipse dot, TextBlock state, bool ready)
    {
        dot.Fill = ready ? ResourceBrush("SuccessBrush") : ResourceBrush("DangerBrush");
        state.Text = ready ? "✔ READY" : "✖ MISSING";
        state.Foreground = ready ? ResourceBrush("SuccessBrush") : ResourceBrush("DangerBrush");
    }

    private static bool ServiceExists(string name)
    {
        try { using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{name}"); return key is not null; }
        catch { return false; }
    }

    private static bool HidHideFolderExists()
    {
        try { var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles); return Directory.Exists(Path.Combine(pf, "Nefarius Software Solutions", "HidHide")); }
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
        HeaderPageTitle.Text = page == CapturePage ? "Capture"
            : page == GamePage ? "Game Control"
            : page == GuidePage ? "Guide"
            : "Check";
        foreach (var nav in new[] { NavCapture, NavGame, NavGuide, NavCheck })
        {
            var active = nav == selectedNav;
            nav.Tag = active ? "NavActive" : null;
            nav.Foreground = active ? ResourceBrush("AccentBrush") : ResourceBrush("TextBrush");
        }
    }
}
