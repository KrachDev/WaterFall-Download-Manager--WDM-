$csharpCode = @"
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class IconBuilderV2
{
    public static void GenerateAll(string srcJpgPath, string projectRoot)
    {
        string assetsDir = Path.Combine(projectRoot, "assets");
        string frontendAssetsDir = Path.Combine(projectRoot, "src", "frontend", "assets");
        string frontendDir = Path.Combine(projectRoot, "src", "frontend");

        Directory.CreateDirectory(assetsDir);
        Directory.CreateDirectory(frontendAssetsDir);

        using (Bitmap src = new Bitmap(srcJpgPath))
        {
            int w = src.Width;
            int h = src.Height;

            // Create 32-bit ARGB bitmap for the round transparent PNG
            using (Bitmap round1024 = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                BitmapData srcData = src.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
                BitmapData dstData = round1024.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);

                int srcBytesCount = Math.Abs(srcData.Stride) * h;
                int dstBytesCount = Math.Abs(dstData.Stride) * h;

                byte[] srcBuffer = new byte[srcBytesCount];
                byte[] dstBuffer = new byte[dstBytesCount];

                Marshal.Copy(srcData.Scan0, srcBuffer, 0, srcBytesCount);

                float cx = (w - 1) / 2.0f;
                float cy = (h - 1) / 2.0f;
                // Circle has diameter of ~1022px, radius ~510.5px
                float radius = 510.5f;

                int srcStride = srcData.Stride;
                int dstStride = dstData.Stride;

                for (int y = 0; y < h; y++)
                {
                    int rowSrcOffset = y * srcStride;
                    int rowDstOffset = y * dstStride;

                    for (int x = 0; x < w; x++)
                    {
                        float dx = x - cx;
                        float dy = y - cy;
                        float dist = (float)Math.Sqrt(dx * dx + dy * dy);

                        int srcIdx = rowSrcOffset + (x * 3);
                        byte b = srcBuffer[srcIdx + 0];
                        byte g = srcBuffer[srcIdx + 1];
                        byte r = srcBuffer[srcIdx + 2];

                        int dstIdx = rowDstOffset + (x * 4);

                        if (dist >= radius + 0.75f)
                        {
                            // Outside circle -> Transparent
                            dstBuffer[dstIdx + 0] = 0;
                            dstBuffer[dstIdx + 1] = 0;
                            dstBuffer[dstIdx + 2] = 0;
                            dstBuffer[dstIdx + 3] = 0;
                        }
                        else if (dist <= radius - 0.75f)
                        {
                            // Fully inside
                            dstBuffer[dstIdx + 0] = b;
                            dstBuffer[dstIdx + 1] = g;
                            dstBuffer[dstIdx + 2] = r;
                            dstBuffer[dstIdx + 3] = 255;
                        }
                        else
                        {
                            // Antialiased edge
                            float alpha = (radius + 0.75f - dist) / 1.5f;
                            if (alpha < 0f) alpha = 0f;
                            if (alpha > 1f) alpha = 1f;

                            if (r > 200 && g > 200 && b > 200)
                            {
                                b = 50;
                                g = 21;
                                r = 10;
                            }

                            dstBuffer[dstIdx + 0] = b;
                            dstBuffer[dstIdx + 1] = g;
                            dstBuffer[dstIdx + 2] = r;
                            dstBuffer[dstIdx + 3] = (byte)(alpha * 255f);
                        }
                    }
                }

                Marshal.Copy(dstBuffer, 0, dstData.Scan0, dstBytesCount);
                src.UnlockBits(srcData);
                round1024.UnlockBits(dstData);

                // Save full resolution transparent PNGs
                string iconPngPath = Path.Combine(assetsDir, "icon.png");
                string logoPngPath = Path.Combine(assetsDir, "waterfall_logo.png");
                string feLogoPath = Path.Combine(frontendAssetsDir, "logo.png");
                string feFaviconPath = Path.Combine(frontendDir, "favicon.png");

                round1024.Save(iconPngPath, ImageFormat.Png);
                round1024.Save(logoPngPath, ImageFormat.Png);
                round1024.Save(feLogoPath, ImageFormat.Png);

                using (Bitmap fav32 = ResizeImage(round1024, 32, 32))
                {
                    fav32.Save(feFaviconPath, ImageFormat.Png);
                }

                // Generate multi-size Windows .ico
                int[] icoSizes = new int[] { 256, 128, 64, 48, 32, 24, 16 };
                List<byte[]> pngBuffers = new List<byte[]>();

                foreach (int s in icoSizes)
                {
                    using (Bitmap scaled = ResizeImage(round1024, s, s))
                    using (MemoryStream ms = new MemoryStream())
                    {
                        scaled.Save(ms, ImageFormat.Png);
                        pngBuffers.Add(ms.ToArray());
                    }
                }

                string icoPath = Path.Combine(assetsDir, "icon.ico");
                WriteIcoFile(icoPath, icoSizes, pngBuffers);

                Console.WriteLine("All icon files successfully generated!");
            }
        }
    }

    private static Bitmap ResizeImage(Bitmap source, int width, int height)
    {
        Bitmap dest = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        dest.SetResolution(source.HorizontalResolution, source.VerticalResolution);

        using (Graphics g = Graphics.FromImage(dest))
        {
            g.CompositingMode = CompositingMode.SourceCopy;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;

            using (ImageAttributes wrapMode = new ImageAttributes())
            {
                wrapMode.SetWrapMode(WrapMode.TileFlipXY);
                g.DrawImage(source, new Rectangle(0, 0, width, height), 0, 0, source.Width, source.Height, GraphicsUnit.Pixel, wrapMode);
            }
        }

        return dest;
    }

    private static void WriteIcoFile(string outputPath, int[] sizes, List<byte[]> pngBuffers)
    {
        using (FileStream fs = new FileStream(outputPath, FileMode.Create, FileAccess.Write))
        using (BinaryWriter bw = new BinaryWriter(fs))
        {
            bw.Write((ushort)0);
            bw.Write((ushort)1);
            bw.Write((ushort)sizes.Length);

            int offset = 6 + (16 * sizes.Length);

            for (int i = 0; i < sizes.Length; i++)
            {
                int s = sizes[i];
                byte[] data = pngBuffers[i];

                bw.Write((byte)(s == 256 ? 0 : s));
                bw.Write((byte)(s == 256 ? 0 : s));
                bw.Write((byte)0);
                bw.Write((byte)0);
                bw.Write((ushort)1);
                bw.Write((ushort)32);
                bw.Write((uint)data.Length);
                bw.Write((uint)offset);

                offset += data.Length;
            }

            for (int i = 0; i < sizes.Length; i++)
            {
                bw.Write(pngBuffers[i]);
            }
        }
    }
}
"@

Add-Type -TypeDefinition $csharpCode -ReferencedAssemblies System.Drawing.dll -Language CSharp

$srcJpg = "C:\Users\Kracher.Krach\.gemini\antigravity-ide\brain\efe2e453-fc50-494a-b9c1-fb37aa3b99ff\waterfall_icon_v2_1791994491316.jpg"
$projRoot = "c:\Users\Kracher.Krach\Documents\Jdownloader rebirth"

[IconBuilderV2]::GenerateAll($srcJpg, $projRoot)
