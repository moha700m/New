using System.Windows.Threading;
using MohammedLab.ColorVision.Core;

namespace MohammedLab.ColorVision;

public partial class App : System.Windows.Application
{
    private readonly DispatcherTimer _controllerUiTimer;
    private bool _trainingLabUiInstalled;

    public App()
    {
        DispatcherUnhandledException += OnDispatcherUnhandledException;

        _controllerUiTimer = new DispatcherTimer(DispatcherPriority.ContextIdle)
        {
            Interval = TimeSpan.FromMilliseconds(70)
        };
        _controllerUiTimer.Tick += (_, _) =>
        {
            var connected = XInput.TryGetState(0, out _);
            ControllerUiStatus.Post(connected);

            if (!_trainingLabUiInstalled && this.MainWindow is MohammedLab.ColorVision.MainWindow main && main.IsLoaded)
            {
                main.InstallTrainingLabUi();
                _trainingLabUiInstalled = true;
            }
        };
        _controllerUiTimer.Start();
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        System.Windows.MessageBox.Show(
            $"Mohammed Lab PC recovered from an unexpected UI error.\n\n{e.Exception.Message}",
            "Mohammed Lab PC",
            System.Windows.MessageBoxButton.OK,
            System.Windows.MessageBoxImage.Warning);
        e.Handled = true;
    }
}
