using System.Windows;
using System.Windows.Controls;
using MohammedLab.ColorVision.Core;

namespace MohammedLab.ColorVision;

public partial class MainWindow
{
    private bool _trainingLabNavInstalled;

    internal void InstallTrainingLabUi()
    {
        if (_trainingLabNavInstalled) return;
        if (NavGame.Parent is not StackPanel navStack) return;

        var button = new Button
        {
            Content = "Color Training Lab",
            Style = (Style)FindResource("NavButton"),
            ToolTip = "Visual/offline color detection tuning. Does not drive aim or firing."
        };
        button.Click += (_, _) => OpenTrainingLab();

        var index = navStack.Children.IndexOf(NavGame);
        navStack.Children.Insert(Math.Min(index + 1, navStack.Children.Count), button);
        _trainingLabNavInstalled = true;
    }

    private void OpenTrainingLab()
    {
        var dialog = new TrainingLabWindow(_settings, persist =>
        {
            SettingsStore.Clamp(_settings);
            _engine.ApplyConfig(_settings);
            if (persist) _store.Save(_settings);
            StatusText.Text = $"Training • {ColorDetector.MarkerLabel(_settings.MarkerPreset)} • FOV {_settings.FovRadiusPx}px";
        })
        {
            Owner = this
        };

        dialog.ShowDialog();
    }
}
