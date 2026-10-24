using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Hydra
{
    static class Program
    {
        private static NotifyIcon trayIcon;
        private static Process serverProcess;
        private static Process edgeProcess;
        private static string appUrl = "http://localhost:4567";
        private static Mutex mutex;

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        private const int SW_RESTORE = 9;

        [STAThread]
        static void Main()
        {
            bool isNewInstance;
            mutex = new Mutex(true, "Global\\WaterfallDownloadManagerInstanceMutex", out isNewInstance);

            if (!isNewInstance)
            {
                // Another instance is already running: launch or restore window
                LaunchOrFocusWindow();
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // 1. Ensure backend daemon is running
            EnsureServerRunning();

            // 2. Setup System Tray Icon
            SetupTrayIcon();

            // 3. Launch native desktop app window
            LaunchOrFocusWindow();

            Application.Run();
        }

        private static void EnsureServerRunning()
        {
            if (IsServerAlive()) return;

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string serverJs = Path.Combine(baseDir, "server.js");
            if (!File.Exists(serverJs))
            {
                serverJs = Path.Combine(Directory.GetParent(baseDir).FullName, "server.js");
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "node.exe",
                    Arguments = "\"" + serverJs + "\"",
                    WorkingDirectory = Path.GetDirectoryName(serverJs),
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                // Propagate user and system PATH so node, yt-dlp, and ffmpeg are found
                string machinePath = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Machine) ?? "";
                string userPath = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
                psi.EnvironmentVariables["Path"] = machinePath + ";" + userPath;

                serverProcess = Process.Start(psi);

                // Wait up to 5 seconds for daemon to respond
                for (int i = 0; i < 25; i++)
                {
                    Thread.Sleep(200);
                    if (IsServerAlive()) break;
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to start Waterfall daemon: " + ex.Message, "Waterfall Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static bool IsServerAlive()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(appUrl + "/api/settings");
                req.Timeout = 1000;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void LaunchOrFocusWindow()
        {
            try
            {
                if (edgeProcess != null && !edgeProcess.HasExited && edgeProcess.MainWindowHandle != IntPtr.Zero)
                {
                    ShowWindow(edgeProcess.MainWindowHandle, SW_RESTORE);
                    SetForegroundWindow(edgeProcess.MainWindowHandle);
                    return;
                }

                string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
                if (!File.Exists(edgePath))
                {
                    edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
                }

                if (File.Exists(edgePath))
                {
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = edgePath,
                        Arguments = "--app=\"" + appUrl + "\" --window-size=1540,920"
                    };
                    edgeProcess = Process.Start(psi);
                }
                else
                {
                    Process.Start(appUrl);
                }
            }
            catch
            {
                try { Process.Start(appUrl); } catch { }
            }
        }

        private static void SetupTrayIcon()
        {
            trayIcon = new NotifyIcon();
            trayIcon.Text = "Waterfall - IDM & JDownloader Suite";
            trayIcon.Icon = CreateAppIcon();
            trayIcon.Visible = true;

            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("🚀 Open Waterfall", (s, e) => LaunchOrFocusWindow());
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("▶️ Resume All Downloads", (s, e) => PostApi("/api/downloads/resume-all"));
            menu.MenuItems.Add("⏸️ Pause All Downloads", (s, e) => PostApi("/api/downloads/pause-all"));
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("📂 Open Downloads Folder", (s, e) => {
                string downloadsPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                Process.Start("explorer.exe", downloadsPath);
            });
            menu.MenuItems.Add("🌐 Open in Web Browser", (s, e) => Process.Start(appUrl));
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("❌ Exit Waterfall", (s, e) => ExitApplication());

            trayIcon.ContextMenu = menu;
            trayIcon.DoubleClick += (s, e) => LaunchOrFocusWindow();
        }

        private static void PostApi(string endpoint)
        {
            ThreadPool.QueueUserWorkItem((state) => {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(appUrl + endpoint);
                    req.Method = "POST";
                    req.ContentLength = 0;
                    req.Timeout = 2000;
                    using (req.GetResponse()) { }
                }
                catch { }
            });
        }

        private static Icon CreateAppIcon()
        {
            // Crisp 32x32 Hydra Obsidian Shield Icon
            Bitmap bmp = new Bitmap(32, 32);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                g.SmoothingMode = SmoothingMode.AntiAlias;

                // Obsidian Shield Background
                using (Brush bgBrush = new SolidBrush(Color.FromArgb(9, 13, 22)))
                {
                    g.FillEllipse(bgBrush, 1, 1, 30, 30);
                }
                using (Pen borderPen = new Pen(Color.FromArgb(59, 130, 246), 2f))
                {
                    g.DrawEllipse(borderPen, 2, 2, 28, 28);
                }

                // High-Speed IDM Arrow
                using (Pen arrowPen = new Pen(Color.FromArgb(96, 165, 250), 3f))
                {
                    g.DrawLine(arrowPen, 16, 7, 16, 21);
                    g.DrawLine(arrowPen, 10, 15, 16, 22);
                    g.DrawLine(arrowPen, 22, 15, 16, 22);
                }

                // Accent amber dot
                using (Brush dotBrush = new SolidBrush(Color.FromArgb(245, 158, 11)))
                {
                    g.FillEllipse(dotBrush, 14, 5, 4, 4);
                }
            }

            IntPtr hIcon = bmp.GetHicon();
            return Icon.FromHandle(hIcon);
        }

        private static void ExitApplication()
        {
            if (trayIcon != null)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }

            // Gracefully instruct Waterfall daemon to flush downloads.json state to disk before exiting
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(appUrl + "/api/save");
                req.Method = "POST";
                req.ContentLength = 0;
                req.Timeout = 1500;
                using (req.GetResponse()) { }
            }
            catch { }

            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                }
            }
            catch { }

            try
            {
                if (edgeProcess != null && !edgeProcess.HasExited)
                {
                    edgeProcess.Kill();
                }
            }
            catch { }

            Application.Exit();
            Environment.Exit(0);
        }
    }
}
