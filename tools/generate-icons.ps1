Add-Type -AssemblyName System.Drawing

$iconDirectory = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null

foreach ($size in @(16, 32, 48, 128)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    # Keep the 128px store icon artwork within the recommended 96px safe area.
    $margin = [Math]::Max(1, [Math]::Round($size * 0.125))
    $background = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#17212b"))
    $graphics.FillEllipse($background, $margin, $margin, $size - (2 * $margin), $size - (2 * $margin))

    $lineWidth = [Math]::Max(2, [Math]::Round($size * 0.12))
    $inset = [Math]::Round($size * 0.24)
    $diameter = $size - (2 * $inset)
    $tealPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#54c4bd"), $lineWidth)
    $coralPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#f4775f"), $lineWidth)
    $tealPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $tealPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $coralPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $coralPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawArc($tealPen, $inset, $inset, $diameter, $diameter, -90, 235)
    $graphics.DrawArc($coralPen, $inset, $inset, $diameter, $diameter, 155, 95)

    $outputPath = Join-Path $iconDirectory "icon$size.png"
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $coralPen.Dispose()
    $tealPen.Dispose()
    $background.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
