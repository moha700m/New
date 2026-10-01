using System.Text.Json;
using System.Text.Json.Serialization;

namespace MohammedLab.ColorVision.Core;

public enum GameMode { Bo7, Bo6, Mw, Mw4, Overwatch }
public enum AimDevice { Mouse, Controller }
public enum PadButton { None, Cross, Circle, Square, Triangle, L1, R1, L2, R2, L3, R3, Create, Options, DpadUp, DpadDown, DpadLeft, DpadRight }
public enum MarkerPreset { Purple, Magenta, Cyan, Red, Yellow }

public sealed class AppConfig
{
    public GameMode Game { get; set; } = GameMode.Bo7;
    public GameMode GuideGame { get; set; } = GameMode.Bo7;
    public int GuideStep { get; set; }
    public int ScreenIndex { get; set; }
    public int ZoneWidth { get; set; } = 400;
    public int ZoneHeight { get; set; } = 560;
    public int CaptureFps { get; set; } = 90;
    public bool NoPreview { get; set; } = false;
    public bool ShowHud { get; set; } = true;
    public AimDevice Device { get; set; } = AimDevice.Mouse;
    public float Strength { get; set; } = 2.8f;
    public int AimPointOffsetPx { get; set; } = 31;
    public bool HoldToAim { get; set; } = true;
    public bool AlwaysTrack { get; set; } = true;
    public int AimKey { get; set; } = 0x02;
    public PadButton AimButton { get; set; } = PadButton.L2;
    public PadButton FireButton { get; set; } = PadButton.R2;
    public bool AntiRecoilOn { get; set; }
    public float AntiRecoil { get; set; } = 6.0f;
    public bool AutoFire { get; set; }
    public int TriggerThreshold { get; set; } = 60;
    public bool SwapTriggers { get; set; }

    // Visual / offline training detector settings. These settings affect only the
    // preview/HUD detector and never drive mouse movement, firing, or controller output.
    public MarkerPreset MarkerPreset { get; set; } = MarkerPreset.Purple;
    public int FovRadiusPx { get; set; } = 170;
    public bool ShowFov { get; set; } = true;
    public double MinConfidence { get; set; } = 0.46;
    public int StableFramesRequired { get; set; } = 2;
    public double PreviewSmoothing { get; set; } = 0.35;

    [JsonIgnore] public static int[] ZoneWidths { get; } = [160, 240, 320, 400, 480, 560, 640, 800];
    [JsonIgnore] public static int[] ZoneHeights { get; } = [160, 240, 320, 400, 480, 560, 640, 800];
    [JsonIgnore] public static int[] CaptureFpsOptions { get; } = [30, 60, 90, 120, 144, 165, 240];
}

public sealed class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };
    public string Folder { get; } = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MohammedLab", "ColorVision");
    public string FilePath => System.IO.Path.Combine(Folder, "settings.json");

    public AppConfig Load()
    {
        try
        {
            if (!System.IO.File.Exists(FilePath)) return new AppConfig();
            var value = JsonSerializer.Deserialize<AppConfig>(System.IO.File.ReadAllText(FilePath), JsonOptions) ?? new AppConfig();
            Clamp(value);
            return value;
        }
        catch { return new AppConfig(); }
    }

    public void Save(AppConfig value)
    {
        Clamp(value);
        System.IO.Directory.CreateDirectory(Folder);
        var tmp = FilePath + ".tmp";
        System.IO.File.WriteAllText(tmp, JsonSerializer.Serialize(value, JsonOptions));
        System.IO.File.Move(tmp, FilePath, true);
    }

    public static void Clamp(AppConfig s)
    {
        s.ZoneWidth = Nearest(s.ZoneWidth, AppConfig.ZoneWidths);
        s.ZoneHeight = Nearest(s.ZoneHeight, AppConfig.ZoneHeights);
        s.CaptureFps = Nearest(s.CaptureFps, AppConfig.CaptureFpsOptions);
        s.ScreenIndex = Math.Max(0, s.ScreenIndex);
        s.Strength = Math.Clamp(s.Strength, 1f, 10f);
        s.AimPointOffsetPx = Math.Clamp(s.AimPointOffsetPx, -100, 100);
        s.AntiRecoil = Math.Clamp(s.AntiRecoil, 0f, 20f);
        s.TriggerThreshold = Math.Clamp(s.TriggerThreshold, 1, 255);
        s.FovRadiusPx = Math.Clamp(s.FovRadiusPx, 40, 400);
        s.MinConfidence = Math.Clamp(s.MinConfidence, 0.20, 0.95);
        s.StableFramesRequired = Math.Clamp(s.StableFramesRequired, 1, 6);
        s.PreviewSmoothing = Math.Clamp(s.PreviewSmoothing, 0.0, 0.90);
    }

    private static int Nearest(int value, IReadOnlyList<int> options) => options.OrderBy(x => Math.Abs(x - value)).First();
}
