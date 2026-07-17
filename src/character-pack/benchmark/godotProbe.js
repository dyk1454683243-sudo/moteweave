import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'

function configuredPath(explicitValue, environmentName) {
  const value = explicitValue === undefined ? process.env[environmentName] : explicitValue
  return String(value ?? '').trim() || null
}

function needsFilesystemAccessCheck(command) {
  return path.isAbsolute(command) || command.includes('/') || command.includes('\\')
}

async function executableExists(filePath) {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function runCommand(command, args, { cwd }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd })
    let stdout = ''
    let stderr = ''
    let settled = false
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      resolve({ code: null, stdout, stderr, error })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      resolve({ code, stdout, stderr, error: null })
    })
  })
}

function safeOutputPath(baseDir, zipName) {
  const normalizedName = zipName.replaceAll('\\', '/')
  const outputPath = path.resolve(baseDir, normalizedName)
  const root = path.resolve(baseDir)
  if (outputPath !== root && !outputPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Unsafe zip path: ${zipName}`)
  }
  return outputPath
}

async function extractZipBuffer(zipBuffer, targetDir) {
  const zip = await JSZip.loadAsync(zipBuffer)
  for (const [name, entry] of Object.entries(zip.files)) {
    const normalizedName = name.replaceAll('\\', '/')
    if (entry.dir || normalizedName.endsWith('/')) continue
    const outputPath = safeOutputPath(targetDir, name)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, await entry.async('nodebuffer'))
  }
}

export function buildPluginScanScript({ targetId, root, generatorPath = '', expectedAnimations = [] }) {
  return `
extends SceneTree

const TARGET_ID := ${JSON.stringify(targetId)}
const ROOT := ${JSON.stringify(root)}
const GENERATOR_PATH := ${JSON.stringify(generatorPath)}
const EXPECTED_ANIMATIONS := ${JSON.stringify(expectedAnimations)}

func _load_texture(sprite_path: String) -> Texture2D:
\tvar image := Image.load_from_file(sprite_path)
\tif image == null or image.is_empty():
\t\tprinterr("texture_load_failed=%s" % sprite_path)
\t\treturn null
\treturn ImageTexture.create_from_image(image)

func _assert_generator(sprite_path: String) -> int:
\tif GENERATOR_PATH == "":
\t\treturn 0
\tvar generator_script := load(GENERATOR_PATH)
\tif generator_script == null:
\t\tprinterr("generator_missing=%s" % GENERATOR_PATH)
\t\treturn 6
\tvar texture := _load_texture(sprite_path)
\tif texture == null:
\t\treturn 7
\tvar frames: SpriteFrames = generator_script.new().build_sprite_frames(texture)
\tif frames == null:
\t\tprinterr("sprite_frames_null")
\t\treturn 8
\tfor anim_name in EXPECTED_ANIMATIONS:
\t\tif not frames.has_animation(anim_name):
\t\t\tprinterr("animation_missing=%s" % anim_name)
\t\t\treturn 9
\t\tvar count := frames.get_frame_count(anim_name)
\t\tprint("animation=%s frames=%d" % [anim_name, count])
\t\tif count <= 0:
\t\t\tprinterr("animation_empty=%s" % anim_name)
\t\t\treturn 10
\treturn 0

func _init() -> void:
\tvar repo_script := load("res://addons/npc_library_tool/core/npc_repository.gd")
\tif repo_script == null:
\t\tprinterr("repo_script_missing")
\t\tquit(1)
\t\treturn
\tvar repo = repo_script.new()
\tvar items: Array = repo.scan_npc_files(ROOT)
\tfor item in items:
\t\tif String(item.get("id", "")) != TARGET_ID:
\t\t\tcontinue
\t\tvar errors: PackedStringArray = item.get("errors", PackedStringArray())
\t\tprint("found_id=%s" % item.get("id", ""))
\t\tprint("errors=%s" % JSON.stringify(Array(errors)))
\t\tif not errors.is_empty():
\t\t\tquit(2)
\t\t\treturn
\t\tvar data: Dictionary = item.get("data", {})
\t\tvar assets: Dictionary = data.get("assets", {})
\t\tvar sprite_path := String(assets.get("spritePath", "./sprite.png"))
\t\tif sprite_path.begins_with("./"):
\t\t\tsprite_path = String(item.get("path", "")).get_base_dir().path_join(sprite_path.substr(2))
\t\tvar generator_status := _assert_generator(sprite_path)
\t\tquit(generator_status)
\t\treturn
\tprinterr("target_not_found")
\tquit(5)
`
}

export async function runGodotProbe({ projectDir, scriptSource, godotBin } = {}) {
  const resolvedGodotBin = configuredPath(godotBin, 'GODOT_BIN')
  if (!resolvedGodotBin) {
    return { available: false, status: 'skipped', reason: 'godot_not_configured' }
  }
  if (needsFilesystemAccessCheck(resolvedGodotBin) && !(await executableExists(resolvedGodotBin))) {
    return { available: false, status: 'skipped', reason: 'godot_not_found' }
  }
  const probeDir = projectDir ?? (await mkdtemp(path.join(os.tmpdir(), 'godot-probe-')))
  const scriptPath = path.join(probeDir, 'scan_npc.gd')
  await writeFile(path.join(probeDir, 'project.godot'), '[application]\nconfig/name="CharacterPackProbe"\n')
  await writeFile(scriptPath, scriptSource)
  const result = await runCommand(resolvedGodotBin, ['--headless', '--path', probeDir, '--script', 'res://scan_npc.gd'], { cwd: probeDir })
  if (result.error?.code === 'ENOENT') {
    return { available: false, status: 'skipped', reason: 'godot_not_found' }
  }
  return {
    available: true,
    status: result.code === 0 ? 'pass' : 'fail',
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

export async function probeCharacterPackZip({
  exportZipBuffer,
  targetId,
  root,
  generatorPath = '',
  expectedAnimations = [],
  pluginZipPath,
  godotBin,
} = {}) {
  if (!exportZipBuffer) return { available: false, status: 'skipped', reason: 'export_zip_missing' }
  const resolvedGodotBin = configuredPath(godotBin, 'GODOT_BIN')
  const resolvedPluginZipPath = configuredPath(pluginZipPath, 'NPC_PLUGIN_ZIP')
  if (!resolvedGodotBin) {
    return { available: false, status: 'skipped', reason: 'godot_not_configured' }
  }
  if (!resolvedPluginZipPath) {
    return { available: false, status: 'skipped', reason: 'plugin_zip_not_configured' }
  }
  if (needsFilesystemAccessCheck(resolvedGodotBin) && !(await executableExists(resolvedGodotBin))) {
    return { available: false, status: 'skipped', reason: 'godot_not_found' }
  }
  if (!(await fileExists(resolvedPluginZipPath))) {
    return { available: false, status: 'skipped', reason: 'plugin_zip_not_found' }
  }
  const probeDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-godot-probe-'))
  await extractZipBuffer(await readFile(resolvedPluginZipPath), probeDir)
  await extractZipBuffer(exportZipBuffer, probeDir)
  return runGodotProbe({
    projectDir: probeDir,
    godotBin: resolvedGodotBin,
    scriptSource: buildPluginScanScript({ targetId, root, generatorPath, expectedAnimations }),
  })
}
