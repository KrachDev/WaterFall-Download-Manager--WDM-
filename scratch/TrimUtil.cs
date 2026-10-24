using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

class Program {
    [DllImport("psapi.dll")]
    static extern bool EmptyWorkingSet(IntPtr hProcess);

    [DllImport("kernel32.dll")]
    static extern bool SetProcessWorkingSetSize(IntPtr hProcess, IntPtr min, IntPtr max);

    static void Main(string[] args) {
        try {
            string target = (args != null && args.Length > 0) ? args[0] : "Waterfall";
            int pid;
            if (int.TryParse(target, out pid)) {
                try {
                    using (var p = Process.GetProcessById(pid)) {
                        EmptyWorkingSet(p.Handle);
                        SetProcessWorkingSetSize(p.Handle, (IntPtr)(-1), (IntPtr)(-1));
                    }
                } catch {}
                return;
            }

            foreach (var p in Process.GetProcesses()) {
                try {
                    string name = p.ProcessName;
                    if (name.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0 ||
                        name.IndexOf("Waterfall", StringComparison.OrdinalIgnoreCase) >= 0) {
                        EmptyWorkingSet(p.Handle);
                        SetProcessWorkingSetSize(p.Handle, (IntPtr)(-1), (IntPtr)(-1));
                    }
                } catch {}
                finally {
                    p.Dispose();
                }
            }
        } catch {}
    }
}
