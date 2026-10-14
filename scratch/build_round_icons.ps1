$csharpCode = @"
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class IconBuilder
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
                            // Completely transparent
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
                            // Smooth sub-pixel antialiased edge
                            float alpha = (radius + 0.75f - dist) / 1.5f;
                            if (alpha < 0f) alpha = 0f;
                            if (alpha > 1f) alpha = 1f;

                            // Prevent white fringe: if edge pixel is close to white background, use the border navy
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

                // 1. Save 1024x1024 PNGs
                string iconPng = Path.Combine(assetsDir, "icon.png");
                string waterfallLogoPng = Path.Combine(assetsDir, "waterfall_logo.png");
                string feLogoPng = Path.Combine(frontendAssetsDir, "logo.png");
                string feFaviconPng = Path.Combine(frontendDir, "favicon.png");

                round1024.Save(iconPng, ImageFormat.Png);
                round1024.Save(waterfallLogoPng, ImageFormat.Png);
                round1024.Save(feLogoPng, ImageFormat.Png);
                Console.WriteLine("Saved: " + iconPng);
                Console.WriteLine("Saved: " + waterfallLogoPng);
                Console.WriteLine("Saved: " + feLogoPng);

                // 2. Favicon (256x256 high quality)
                using (Bitmap favBmp = ResizeImage(round1024, 256, 256))
                {
                    favBmp.Save(feFaviconPng, ImageFormat.Png);
                    Console.WriteLine("Saved: " + feFaviconPng);
                }

                // 3. Multi-resolution ICO: 256, 128, 64, 48, 32, 16
                int[] sizes = new int[] { 256, 128, 64, 48, 32, 16 };
                List<byte[]> pngBuffers = new List<byte[]>();

                foreach (int s in sizes)
                {
                    using (Bitmap scaled = ResizeImage(round1024, s, s))
                    using (MemoryStream ms = new MemoryStream())
                    {
                        scaled.Save(ms, ImageFormat.Png);
                        pngBuffers.Add(ms.ToArray());
                    }
                }

                string icoPath = Path.Combine(assetsDir, "icon.ico");
                WriteIcoFile(icoPath, sizes, pngBuffers);
                Console.WriteLine("Saved multi-res ICO: " + icoPath);
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
            // ICO Header: 6 bytes
            bw.Write((ushort)0); // Reserved, must be 0
            bw.Write((ushort)1); // Image type: 1 = ICO
            bw.Write((ushort)sizes.Length); // Number of images

            // Directory entries: 16 bytes per image
            int offset = 6 + (16 * sizes.Length);

            for (int i = 0; i < sizes.Length; i++)
            {
                int s = sizes[i];
                byte[] data = pngBuffers[i];

                bw.Write((byte)(s == 256 ? 0 : s)); // Width: 0 means 256
                bw.Write((byte)(s == 256 ? 0 : s)); // Height: 0 means 256
                bw.Write((byte)0); // Color count: 0 for 32bpp
                bw.Write((byte)0); // Reserved: 0
                bw.Write((ushort)1); // Color planes
                bw.Write((ushort)32); // Bits per pixel
                bw.Write((uint)data.Length); // Size of image data
                bw.Write((uint)offset); // File offset of image data

                offset += data.Length;
            }

            // Write image data blocks
            for (int i = 0; i < sizes.Length; i++)
            {
                bw.Write(pngBuffers[i]);
            }
        }
    }
}
"@

Add-Type -TypeDefinition $csharpCode -ReferencedAssemblies System.Drawing.dll -Language CSharp

$srcJpg = "C:\Users\Kracher.Krach\.gemini\antigravity-ide\brain\62d53ce7-7da1-4c92-99ea-183108aa2196\waterfall_round_icon_1791973407256.jpg"
$projRoot = "c:\Users\Kracher.Krach\Documents\Jdownloader rebirth"

[IconBuilder]::GenerateAll($srcJpg, $projRoot)
