using System.Windows;
using MohammedLab.ColorVision.Core;

namespace MohammedLab.ColorVision;

public partial class TrainingLabWindow : Window
{
    private readonly AppConfig _config;
    private readonly Action<bool> _apply;
    private bool _loaded;

    public TrainingLabWindow(AppConfig config, Action<bool> apply)
    {
        InitializeComponent();
        _config = config;
        _apply = apply;

        CmbMarker.ItemsSource = Enum.GetValues<MarkerPreset>();
        CmbMarker.SelectedItem = config.MarkerPreset;
        SldFov.Value = config.FovRadiusPx;
        ChkShowFov.IsChecked = config.ShowFov;
        SldConfidence.Value = config.MinConfidence * 100.0;
        SldStability.Value = config.StableFramesRequired;
        SldSmoothing.Value = config.PreviewSmoothing * 100.0;
        _loaded = true;
        UpdateText();
    }

    private void ControlChanged(object sender, RoutedEventArgs e)
    {
        if (!_loaded) return;
        ApplyToConfig(persist: false);
    }

    private void ApplyToConfig(bool persist)
    {
        _config.MarkerPreset = CmbMarker.SelectedItem is MarkerPreset marker ? marker : MarkerPreset.Purple;
        _config.FovRadiusPx = (int)Math.Round(SldFov.Value);
        _config.ShowFov = ChkShowFov.IsChecked == true;
        _config.MinConfidence = SldConfidence.Value / 100.0;
        _config.StableFramesRequired = (int)Math.Round(SldStability.Value);
        _config.PreviewSmoothing = SldSmoothing.Value / 100.0;
        SettingsStore.Clamp(_config);
        UpdateText();
        _apply(persist);
    }

    private void UpdateText()
    {
        TxtFov.Text = $"{Math.Round(SldFov.Value):0}px";
        TxtConfidence.Text = $"{SldConfidence.Value:0}%";
        TxtStability.Text = $"{Math.Round(SldStability.Value):0} frames";
        TxtSmoothing.Text = $"{SldSmoothing.Value:0}%";
        var marker = CmbMarker.SelectedItem is MarkerPreset selected ? selected : MarkerPreset.Purple;
        TxtSummary.Text = $"{ColorDetector.MarkerLabel(marker)} • FOV {Math.Round(SldFov.Value):0}px • confidence {SldConfidence.Value:0}% • {Math.Round(SldStability.Value):0} stable frames • smoothing {SldSmoothing.Value:0}%";
    }

    private void SetProfile(int fov, double confidence, int stableFrames, double smoothing)
    {
        _loaded = false;
        SldFov.Value = fov;
        SldConfidence.Value = confidence * 100.0;
        SldStability.Value = stableFrames;
        SldSmoothing.Value = smoothing * 100.0;
        ChkShowFov.IsChecked = true;
        _loaded = true;
        ApplyToConfig(persist: false);
    }

    private void PresetClose_Click(object sender, RoutedEventArgs e) => SetProfile(110, 0.55, 3, 0.20);
    private void PresetBalanced_Click(object sender, RoutedEventArgs e) => SetProfile(170, 0.46, 2, 0.35);
    private void PresetWide_Click(object sender, RoutedEventArgs e) => SetProfile(240, 0.40, 2, 0.50);

    private void Reset_Click(object sender, RoutedEventArgs e)
    {
        _loaded = false;
        CmbMarker.SelectedItem = MarkerPreset.Purple;
        SldFov.Value = 170;
        ChkShowFov.IsChecked = true;
        SldConfidence.Value = 46;
        SldStability.Value = 2;
        SldSmoothing.Value = 35;
        _loaded = true;
        ApplyToConfig(persist: false);
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    private void SaveClose_Click(object sender, RoutedEventArgs e)
    {
        ApplyToConfig(persist: true);
        Close();
    }
}
