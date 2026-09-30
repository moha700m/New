using System.Security.Principal;
using System.Windows;
using System.Windows.Controls;
using MessageBox = System.Windows.MessageBox;
using MohammedLab.ColorVision.Core;

namespace MohammedLab.ColorVision;

public partial class MainWindow : Window
{
    private readonly SettingsStore _store = new();
    private readonly AppConfig _settings;
    private readonly AimEngine _engine;
    private bool _loading = true;

    public MainWindow()
    {
        InitializeComponent();
        _settings = _store.Load();
        _engine = new AimEngine(_settings);
        _engine.TelemetryUpdated += Engine_TelemetryUpdated;
        _engine.Faulted += Engine_Faulted;
        PopulateControls();
        LoadSettingsToUi();
        ShowPage(CapturePage);
        RunCheck();
        Closed += async (_, _) => { await _engine.StopAsync(); _engine.Dispose(); };
    }

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
            CmbGame.SelectedIndex = (int)_settings.Game;
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
            GuideTabs.SelectedIndex = Math.Clamp((int)_settings.GuideGame, 0, 3);
            RefreshUiText();
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
        _settings.Game = (GameMode)Math.Clamp(CmbGame.SelectedIndex, 0, 4);
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
        SettingsStore.Clamp(_settings);
        _store.Save(_settings);
        _engine.ApplyConfig(_settings);
        RefreshUiText();
    }

    private void RefreshUiText()
    {
        TxtStrength.Text = _settings.Strength.ToString("0.0");
        TxtOffset.Text = $"{_settings.AimPointOffsetPx}px";
        TxtRecoil.Text = _settings.AntiRecoil.ToString("0.0");
        RecoilRow.IsEnabled = _settings.AntiRecoilOn;
        StatusDevice.Text = $"Device: {_settings.Device}";
        TxtDeviceNote.Text = _settings.Device == AimDevice.Mouse
            ? "Mouse mode uses the selected mouse aim key. Default: Right Mouse."
            : "Controller mode uses the selected Aim / Fire buttons and a virtual Xbox controller.";
    }

    private void SettingChanged(object sender, RoutedEventArgs e) => ReadUiToSettings();

    private async void BtnToggle_Click(object sender, RoutedEventArgs e)
    {
        ReadUiToSettings();
        if (!_engine.Running)
        {
            if (_engine.Start())
            {
                BtnToggle.Content = "Stop";
                StatusText.Text = "Running";
            }
        }
        else
        {
            await _engine.StopAsync();
            BtnToggle.Content = "Start";
            StatusText.Text = "Ready";
        }
    }

    private void Engine_TelemetryUpdated()
    {
        Dispatcher.BeginInvoke(() =>
        {
            var d = _engine.LastDetection;
            var g = _engine.LastControllerState.Gamepad;
            TxtFps.Text = $"Capture: {_engine.CaptureFps:0.0} FPS";
            TxtDet.Text = $"Detection: {d.ProcessingMs:0.00} ms • hits {d.CandidateCount}";
            TxtFrames.Text = d.Found ? $"Target: {d.Target.X}, {d.Target.Y}" : "Target: none";
            TxtPad.Text = $"LX {g.sThumbLX,6}  LY {g.sThumbLY,6}  RX {g.sThumbRX,6}  RY {g.sThumbRY,6}\nLT {g.bLeftTrigger,3}  RT {g.bRightTrigger,3}  Buttons 0x{(ushort)g.wButtons:X4}";
            StatusText.Text = "Running";
        });
    }

    private void Engine_Faulted(string text) => Dispatcher.BeginInvoke(() =>
    {
        StatusText.Text = "Error";
        MessageBox.Show(this, text, "Mohammed Lab PC", MessageBoxButton.OK, MessageBoxImage.Error);
    });

    private void BtnReplug_Click(object sender, RoutedEventArgs e)
    {
        try { _engine.ReplugController(); StatusText.Text = "Controller replugged"; }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "Controller", MessageBoxButton.OK, MessageBoxImage.Warning); }
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
        TxtCheckOs.Text = $"Windows: {Environment.OSVersion.Version}";
        TxtCheckRuntime.Text = $".NET: {Environment.Version}";
        var admin = false;
        try { using var identity = WindowsIdentity.GetCurrent(); admin = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator); } catch { }
        TxtCheckAdmin.Text = $"Administrator: {(admin ? "Yes" : "No")}";
        TxtCheckPad.Text = $"Physical controller: {(XInput.TryGetState(0, out _) ? "Connected" : "Not detected")}";
        if (_engine.Running) TxtCheckVigem.Text = $"Virtual controller: {_engine.VirtualControllerStatus}";
        else
        {
            using var test = new VirtualController();
            TxtCheckVigem.Text = $"ViGEm: {(test.Connect() ? "Ready" : test.Status)}";
        }
    }

    private void NavCapture_Click(object sender, RoutedEventArgs e) => ShowPage(CapturePage);
    private void NavGame_Click(object sender, RoutedEventArgs e) => ShowPage(GamePage);
    private void NavGuide_Click(object sender, RoutedEventArgs e) => ShowPage(GuidePage);
    private void NavCheck_Click(object sender, RoutedEventArgs e) { RunCheck(); ShowPage(CheckPage); }

    private void ShowPage(UIElement page)
    {
        CapturePage.Visibility = Visibility.Collapsed; GamePage.Visibility = Visibility.Collapsed;
        GuidePage.Visibility = Visibility.Collapsed; CheckPage.Visibility = Visibility.Collapsed;
        page.Visibility = Visibility.Visible;
    }
}
