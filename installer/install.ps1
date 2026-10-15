# 砚 · 一键安装（Windows）
# 把主题「砚」、工作台插件「砚台」和公文排版片段装进你选的 Obsidian 笔记库。
# 通常双击仓库根目录的「一键安装（Windows）.bat」运行；也可以直接带参数运行：
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Vault "D:\笔记" -City 杭州
# 要兼容 Windows 自带的 PowerShell 5.1：本文件必须保存为带 BOM 的 UTF-8。

param(
  [string]$Vault,
  [string]$City,
  [switch]$SkipCity
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$files = @(
  @{ From = 'theme.css'; To = 'themes/Yan/theme.css' },
  @{ From = 'manifest.json'; To = 'themes/Yan/manifest.json' },
  @{ From = 'yan-desk/manifest.json'; To = 'plugins/yan-desk/manifest.json' },
  @{ From = 'yan-desk/main.js'; To = 'plugins/yan-desk/main.js' },
  @{ From = 'yan-desk/styles.css'; To = 'plugins/yan-desk/styles.css' },
  @{ From = 'snippets/word-style.css'; To = 'snippets/word-style.css' }
)

function Say([string]$text, [string]$color) {
  if ($color) { Write-Host $text -ForegroundColor $color } else { Write-Host $text }
}

# Obsidian 读配置时不认 BOM，所以写 JSON 一律用不带 BOM 的 UTF-8
function Write-Utf8([string]$path, [string]$text) {
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

function Read-Json([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $raw = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
  if (-not $raw.Trim()) { return $null }
  return $raw | ConvertFrom-Json
}

function Find-Vaults {
  $config = Read-Json (Join-Path $env:APPDATA 'obsidian/obsidian.json')
  $found = @()
  if ($config -and $config.vaults) {
    foreach ($entry in $config.vaults.PSObject.Properties) {
      $v = $entry.Value
      if ($v.path -and (Test-Path -LiteralPath $v.path -PathType Container)) {
        $found += [pscustomobject]@{ Path = [string]$v.path; Ts = [double]$v.ts }
      }
    }
  }
  return @($found | Sort-Object Ts -Descending)
}

function Choose-Vault {
  $vaults = @(Find-Vaults)
  if ($vaults.Count -eq 0) {
    Say '没有自动找到 Obsidian 笔记库。' Yellow
    return Read-Host '请把笔记库文件夹拖进这个窗口（或输入它的完整路径），然后按回车'
  }
  Say '找到这些笔记库（最近打开的在最前面）：'
  for ($i = 0; $i -lt $vaults.Count; $i++) {
    Say ('  {0}. {1}' -f ($i + 1), $vaults[$i].Path)
  }
  while ($true) {
    $answer = Read-Host '装到哪一个？输入序号后按回车（直接回车选第 1 个；也可以粘贴其他路径）'
    $answer = $answer.Trim()
    if (-not $answer) { return $vaults[0].Path }
    $n = 0
    if ([int]::TryParse($answer, [ref]$n)) {
      if ($n -ge 1 -and $n -le $vaults.Count) { return $vaults[$n - 1].Path }
      Say "没有第 $n 个，请重新输入。" Yellow
    } else {
      return $answer
    }
  }
}

function Set-WeatherCity([string]$pluginDir, [string]$name) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&format=json&name=' + [uri]::EscapeDataString($name)
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
    # PowerShell 5.1 会把没写编码的中文当成西文解码，这里按 UTF-8 自己解
    $text = [Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray())
    $hit = ($text | ConvertFrom-Json).results | Select-Object -First 1
  } catch {
    Say '暂时连不上天气服务，城市没有设置。装好后可以在工作台的设置里再填。' Yellow
    return
  }
  if (-not $hit) {
    Say "没找到「$name」，城市没有设置。装好后可以在工作台的设置里换个写法再试。" Yellow
    return
  }
  $label = $hit.name
  if ($hit.admin1 -and $hit.admin1 -ne $hit.name) { $label = "$($hit.admin1) · $($hit.name)" }
  $dataPath = Join-Path $pluginDir 'data.json'
  $data = Read-Json $dataPath
  if (-not $data) { $data = [pscustomobject]@{} }
  $data | Add-Member -NotePropertyName city -NotePropertyValue $name -Force
  $data | Add-Member -NotePropertyName place -NotePropertyValue $label -Force
  $data | Add-Member -NotePropertyName latitude -NotePropertyValue ([double]$hit.latitude) -Force
  $data | Add-Member -NotePropertyName longitude -NotePropertyValue ([double]$hit.longitude) -Force
  $data | Add-Member -NotePropertyName lastWeather -NotePropertyValue $null -Force
  Write-Utf8 $dataPath ($data | ConvertTo-Json -Depth 20)
  Say "天气城市：$label" Green
}

try {
  Say ''
  Say '砚 · 一键安装' Cyan
  Say '会装好：主题「砚」、工作台插件「砚台」、公文排版片段。'
  Say ''

  foreach ($f in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $f.From))) {
      throw "找不到安装文件 $($f.From)。请先把下载的压缩包整个解压出来，再双击运行安装。"
    }
  }

  if (-not $Vault) { $Vault = Choose-Vault }
  $Vault = $Vault.Trim().Trim('"').Trim("'")
  if (-not $Vault -or -not (Test-Path -LiteralPath $Vault -PathType Container)) {
    throw "找不到文件夹：$Vault"
  }
  $obs = Join-Path $Vault '.obsidian'
  if (-not (Test-Path -LiteralPath $obs)) {
    Say '这个文件夹里没有 .obsidian，看起来还没用 Obsidian 打开过。会新建一个。' Yellow
  }

  # Obsidian 开着的话，退出时会把旧设置写回去，盖掉这里的改动
  while (Get-Process -Name 'Obsidian' -ErrorAction SilentlyContinue) {
    Say '检测到 Obsidian 正在运行。请先完全退出 Obsidian（包括任务栏右下角的图标），然后按回车继续。' Yellow
    Read-Host | Out-Null
  }

  foreach ($f in $files) {
    $dest = Join-Path $obs $f.To
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $f.From) -Destination $dest -Force
  }
  Say '文件已放好。' Green

  # 主题选「砚」，其他外观设置保持原样
  $appearancePath = Join-Path $obs 'appearance.json'
  $appearance = Read-Json $appearancePath
  if (-not $appearance) { $appearance = [pscustomobject]@{} }
  $appearance | Add-Member -NotePropertyName cssTheme -NotePropertyValue 'Yan' -Force
  Write-Utf8 $appearancePath ($appearance | ConvertTo-Json -Depth 20)

  # 把工作台加进已启用的第三方插件，原来的插件保留
  $pluginsPath = Join-Path $obs 'community-plugins.json'
  $ids = @(Read-Json $pluginsPath | Where-Object { $_ })
  if ($ids -notcontains 'yan-desk') { $ids += 'yan-desk' }
  $quoted = $ids | ForEach-Object { '  "' + ([string]$_ -replace '\\', '\\' -replace '"', '\"') + '"' }
  Write-Utf8 $pluginsPath ("[`n" + ($quoted -join ",`n") + "`n]")
  Say '主题已设为「砚」，工作台插件已登记。' Green

  if (-not $SkipCity) {
    if (-not $City) {
      Say ''
      $City = Read-Host '你所在的城市（工作台显示天气用，比如：杭州；直接回车跳过）'
    }
    if ($City -and $City.Trim()) { Set-WeatherCity (Join-Path $obs 'plugins/yan-desk') $City.Trim() }
  }

  Say ''
  Say '装好了。接下来：' Cyan
  Say '  1. 打开 Obsidian，进入刚才选的笔记库。'
  Say '  2. 如果弹出「你是否信任这个仓库的作者？」，点「信任仓库作者并启用插件」。'
  Say '  3. 没有弹窗、也没看到工作台的话：打开「设置 → 第三方插件」，点「退出受限模式」，'
  Say '     再在「已安装插件」里打开「砚台 · 工作台」。'
  Say '  4. 公文排版片段已放好，需要时在「设置 → 外观 → CSS 样式代码片段」里打开 word-style。'
  Say ''
  exit 0
} catch {
  Say ''
  Say ('安装没有完成：' + $_.Exception.Message) Red
  exit 1
}
