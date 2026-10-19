param(
  [int]$Port = 4173,
  [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$rootFull = [System.IO.Path]::GetFullPath($Root)
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving $rootFull at http://localhost:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".webp" = "image/webp"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".woff" = "font/woff"
  ".woff2"= "font/woff2"
  ".ttf"  = "font/ttf"
  ".mp3"  = "audio/mpeg"
  ".wav"  = "audio/wav"
  ".mp4"  = "video/mp4"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $res.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    $res.Headers["Access-Control-Allow-Origin"] = "*"

    if ($req.HttpMethod -eq "OPTIONS") {
      $res.StatusCode = 204
      $res.Close()
      continue
    }

    # endpoint used by the page to store captured stills
    if ($req.HttpMethod -eq "POST" -and $req.Url.AbsolutePath -eq "/save") {
      $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd()
      $reader.Close()
      $obj = $body | ConvertFrom-Json
      $rawName = [string]$obj.name
      $rel = $rawName -replace '[\\]', '/'
      $rel = $rel.TrimStart('/')
      $parts = $rel -split '/'
      $safeParts = @()
      foreach ($p in $parts) {
        $clean = $p -replace '[^A-Za-z0-9._-]', ''
        if ($clean) { $safeParts += $clean }
      }
      $safeName = $safeParts -join '/'
      $payload = ([string]$obj.data -split ",", 2)[1]
      $bytes = [Convert]::FromBase64String($payload)
      $dir = Join-Path $rootFull "screenshots"
      $file = Join-Path $rootFull $safeName
      New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
      [System.IO.File]::WriteAllBytes($file, $bytes)
      $ok = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
      $res.StatusCode = 200
      $res.ContentType = "application/json; charset=utf-8"
      $res.ContentLength64 = $ok.Length
      $res.OutputStream.Write($ok, 0, $ok.Length)
      $res.Close()
      continue
    }

    $rawPath = $req.Url.AbsolutePath
    if ($rawPath -eq "/" -or $rawPath -eq "") { $rawPath = "/index.html" }
    $decoded = [System.Uri]::UnescapeDataString($rawPath)
    $rel = $decoded.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))

    $isInside = $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $isInside -or -not [System.IO.File]::Exists($full)) {
      $res.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $res.ContentType = "text/plain; charset=utf-8"
      $res.ContentLength64 = $body.Length
      $res.OutputStream.Write($body, 0, $body.Length)
      $res.Close()
      continue
    }

    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $type = $mime[$ext]
    if (-not $type) { $type = "application/octet-stream" }

    $bytes = [System.IO.File]::ReadAllBytes($full)
    $res.StatusCode = 200
    $res.ContentType = $type
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
  } catch {
    try { $res.StatusCode = 500; $res.Close() } catch {}
  }
}
