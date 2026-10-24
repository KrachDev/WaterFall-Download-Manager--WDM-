using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

class Program {
    [DllImport("psapi.dll")]
    static extern bool EmptyWorkingSet(IntPtr hProcess);

    static void Main(string[] args) {
        string procName = args.Length > 0 ? args[0] : "Waterfall";
        foreach (var p in Process.GetProcessesByName(procName)) {
            try {
                EmptyWorkingSet(p.Handle);
            } catch {}
        }
    }
}
