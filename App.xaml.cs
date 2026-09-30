using System.Windows.Threading;

namespace MohammedLab.ColorVision;

public partial class App : System.Windows.Application
{
    public App()
    {
        DispatcherUnhandledException += OnDispatcherUnhandledException;
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
