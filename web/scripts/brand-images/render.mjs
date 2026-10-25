// Renders the share card and app icons into web/public with a headless Edge or Chrome.
// Run from anywhere: `node web/scripts/brand-images/render.mjs`. Needs no npm packages.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '../../public')

const browsers = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const browser = browsers.find((path) => existsSync(path))
if (!browser) throw new Error('No Edge or Chrome found. Set BROWSER_PATH to one.')

const shots = [
  { page: 'og.html', out: 'og.png', width: 1200, height: 630 },
  { page: 'icon.html?size=180', out: 'apple-touch-icon.png', width: 180, height: 180 },
  { page: 'icon.html?size=192', out: 'icon-192.png', width: 192, height: 192 },
  { page: 'icon.html?size=512', out: 'icon-512.png', width: 512, height: 512 },
  { page: 'icon.html?size=512&maskable', out: 'icon-maskable-512.png', width: 512, height: 512 },
]

for (const { page, out, width, height } of shots) {
  const [file, query = ''] = page.split('?')
  const url = pathToFileURL(join(here, file)).href + (query && `?${query}`)
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--allow-file-access-from-files',
    '--virtual-time-budget=3000',
    `--window-size=${width},${height}`,
    `--screenshot=${join(publicDir, out)}`,
    url,
  ])
  console.log(`wrote public/${out}`)
}
