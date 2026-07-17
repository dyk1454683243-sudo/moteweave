import path from 'node:path'

import { ACTION_REPAIR_MODE, isStaticPoseRepairTask, repairOutputFrameCountForTask } from '../actionRepairMode.js'
import { TOPDOWN_RPG_V0 } from '../profile.js'

export const CHARACTER_QUALITY_CLOSURE_PROVIDER_HANDOFF_MODE = 'character_quality_closure_provider_handoff_v1'

const ACTION_SCORE = Object.freeze({
  semantic_frame_repair: 70,
  single_animation_repair: 50,
})

const ISSUE_SCORE = Object.freeze({
  prop_side_flip_suspected: 45,
  motion_inconsistent: 25,
})

const ANIMATION_SCORE = Object.freeze({
  walk_left: 35,
  walk_right: 34,
  walk_down: 30,
  walk_up: 29,
  attack_left: 24,
  attack_right: 23,
  attack_down: 22,
  attack_up: 21,
  hurt: 15,
})

function safePathSegment(value, fallback = 'item') {
  return (
    String(value ?? fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '') || fallback
  )
}

function frameNumbers(task = {}) {
  return (task.target?.frames ?? [])
    .map((frame) => Number(frame.frame ?? frame))
    .filter(Number.isInteger)
}

function providerTasks(manifest = {}) {
  return (manifest.tasks ?? []).filter((task) => task.provider_required)
}

function countProviderTasksByItem(tasks = []) {
  const counts = new Map()
  for (const task of tasks) counts.set(task.item_id, (counts.get(task.item_id) ?? 0) + 1)
  return counts
}

function taskScore(task, itemProviderCount) {
  const animation = task.target?.animation ?? task.animation ?? ''
  const issueType = task.issue?.type ?? ''
  const closenessScore = Math.max(0, 50 - itemProviderCount * 10)
  return (
    closenessScore +
    (ACTION_SCORE[task.action] ?? 10) +
    (ISSUE_SCORE[issueType] ?? 0) +
    (ANIMATION_SCORE[animation] ?? 5) +
    Math.min(8, frameNumbers(task).length)
  )
}

export function rankQualityClosureProviderRepairTasks(manifest = {}) {
  const tasks = providerTasks(manifest)
  const byItem = countProviderTasksByItem(tasks)
  return tasks
    .map((task) => {
      const itemProviderTaskCount = byItem.get(task.item_id) ?? 0
      const score = taskScore(task, itemProviderTaskCount)
      return {
        task,
        rank: {
          score,
          item_provider_task_count: itemProviderTaskCount,
          action_score: ACTION_SCORE[task.action] ?? 10,
          issue_score: ISSUE_SCORE[task.issue?.type ?? ''] ?? 0,
          animation_score: ANIMATION_SCORE[task.target?.animation ?? task.animation ?? ''] ?? 5,
          frame_count: frameNumbers(task).length,
          rationale: [
            itemProviderTaskCount <= 2
              ? 'near-pass item with few remaining provider/manual tasks'
              : 'item has multiple remaining provider/manual tasks',
            task.action === 'semantic_frame_repair'
              ? 'semantic consistency repair is the current highest-value closure target'
              : 'motion repair is useful after semantic side consistency is stable',
            task.target?.animation?.startsWith('walk_')
              ? 'walk animation affects frequent runtime movement previews'
              : 'non-walk animation is lower priority for first closure proof',
          ],
        },
      }
    })
    .sort((a, b) => (
      b.rank.score - a.rank.score ||
      a.rank.item_provider_task_count - b.rank.item_provider_task_count ||
      String(a.task.item_id ?? '').localeCompare(String(b.task.item_id ?? '')) ||
      String(a.task.task_id ?? '').localeCompare(String(b.task.task_id ?? ''))
    ))
}

function targetDirection(animation = '') {
  const match = String(animation).match(/_(down|up|left|right)$/)
  return match ? match[1] : null
}

export function buildQualityClosureProviderRepairPrompt(task, profile = TOPDOWN_RPG_V0, {
  motionTemplate = false,
} = {}) {
  const frames = task.target?.frames ?? []
  const frameList = frames.map((frame) => `${frame.frame} (row ${frame.row}, column ${frame.col})`).join(', ')
  const cellCount = Math.max(1, frames.length)
  const outputCellCount = repairOutputFrameCountForTask(task, cellCount)
  const width = profile.frame.w * outputCellCount
  const height = profile.frame.h
  const basePrompt = task.provider_payload?.prompt
  const animation = task.target?.animation ?? 'unknown'
  const sourceAction = task.target?.source_action ?? task.source_action ?? null
  const derivedFrames = Array.isArray(task.target?.derived_frames) ? task.target.derived_frames : []
  const direction = targetDirection(animation)
  const staticPose = isStaticPoseRepairTask(task)
  const repairMode = staticPose ? ACTION_REPAIR_MODE.STATIC_POSE : ACTION_REPAIR_MODE.ANIMATION_STRIP
  return [
    staticPose
      ? 'Repair exactly one static pose cell from the provided normalized character sheet.'
      : 'Repair exactly one animation strip from the provided normalized character sheet.',
    '',
    `Task id: ${task.task_id}`,
    `Target ${sourceAction ? `source action: ${sourceAction}; mapped runtime animation: ${animation}` : `animation: ${animation}`}`,
    `Target frames in order: ${frameList || 'unknown'}`,
    `Repair mode: ${repairMode}`,
    staticPose
      ? `Required output: one full transparent normalized sheet, ${profile.sheet.w}x${profile.sheet.h}px, preserving the original 8x8 grid. Edit only the listed target frames. The app will crop the first target cell from your returned sheet and paste that same static pose into all listed target frames locally.`
      : `Required output: one horizontal transparent PNG strip, ${width}x${height}px, containing exactly ${cellCount} cells of ${profile.frame.w}x${profile.frame.h}px, left-to-right in the listed frame order.`,
    direction ? `Target facing direction: ${direction}. ${staticPose ? 'The repaired pose' : 'Every cell in the repaired strip'} must keep this facing direction.` : null,
    '',
    'Attached reference images, in order:',
    ...(motionTemplate
      ? [
          '1. Motion template action strip: motion, pose rhythm, facing direction, and frame order reference. Do not copy its character design.',
          '2. Full normalized character sheet: identity, scale, palette, outline weight, costume, and pixel density reference.',
          '3. Current target animation strip: problem context and frame order reference. Repair the bad semantics; do not copy the mistake.',
          '4. Optional source sheet, when present: secondary context only.',
        ]
      : [
          '1. Full normalized character sheet: identity, scale, palette, outline weight, costume, and pixel density reference.',
          '2. Current target animation strip: problem context and frame order reference. Repair the bad semantics; do not copy the mistake.',
          '3. Optional source sheet, when present: secondary context only.',
        ]),
    '',
    'Hard constraints:',
    '- Do not output a full sheet, contact sheet, scene, UI, border, watermark, labels, or helper marks.',
    staticPose ? '- Do not output a cropped character, single large portrait, animation strip, contact sheet, or several pose variations.' : null,
    staticPose ? '- Keep every non-target cell visually unchanged; local application will ignore non-target changes as an extra safety guard.' : null,
    '- Do not change unrelated animations or character identity.',
    '- Preserve scale, palette, outline weight, lighting direction, costume details, and pixel density from the normalized sheet.',
    motionTemplate ? '- Follow the motion template for pose rhythm and facing; follow the normalized character sheet for appearance.' : null,
    `- Keep feet-center anchors visually aligned to x=${profile.anchor.x}, y=${profile.anchor.y} inside each output cell, with clear transparent padding.`,
    '- Default to empty hands: do not add ladders, weapons, shields, tools, props, or handheld items unless the character description explicitly requires them.',
    '- Keep each cell as one clean character silhouette with no duplicated arms or hands, ghost limbs, action trails, motion blur, summoned limbs, or extra anatomy.',
    '- Show motion by changing the pose between cells, not by drawing several limb positions inside one cell.',
    '- Keep held props/accessories on the same intended side across all frames unless the target action explicitly requires a side change.',
    derivedFrames.length ? `- The app will locally derive ${derivedFrames.length} additional runtime cells from this repaired source action, including mirrored right-facing cells when needed. Do not draw extra mirrored cells in your output.` : null,
    '',
    'Reference prompt context:',
    basePrompt ?? 'Use the normalized sheet as the visual reference and repair only the target animation strip.',
  ].filter(Boolean).join('\n')
}

function applyCommand({ manifestPath, task, outputDir }) {
  return [
    'npm run character-pack -- benchmark quality-closure-apply-provider-repair',
    `  --manifest ${manifestPath ?? '<quality_closure_repair_manifest.json>'}`,
    `  --repair ${task.task_id}=<repaired_animation_strip.png>`,
    `  --output-dir ${outputDir ? path.join(outputDir, 'apply') : '<apply_run_dir>'}`,
  ].join(' \\\n')
}

export function buildQualityClosureProviderHandoff(manifest = {}, {
  manifestPath = null,
  taskId = null,
  outputDir = null,
  profile = TOPDOWN_RPG_V0,
} = {}) {
  const ranked = rankQualityClosureProviderRepairTasks(manifest)
  if (!ranked.length) {
    return {
      schema_version: 1,
      mode: CHARACTER_QUALITY_CLOSURE_PROVIDER_HANDOFF_MODE,
      status: 'ready',
      run_id: manifest.run_id ?? null,
      preset: manifest.preset ?? profile.id,
      selected: null,
      candidates: [],
      claim_boundary: 'No provider/manual repair handoff was created because the manifest has no provider-required tasks.',
    }
  }

  const selected = taskId
    ? ranked.find((entry) => entry.task.task_id === taskId)
    : ranked[0]
  if (!selected) throw new Error(`Unknown quality closure provider repair task id: ${taskId}`)

  const prompt = buildQualityClosureProviderRepairPrompt(selected.task, profile)
  const selectedFrames = frameNumbers(selected.task)
  const outputCellCount = repairOutputFrameCountForTask(selected.task, selectedFrames.length)
  const staticPose = isStaticPoseRepairTask(selected.task)
  const outputBase = outputDir ?? path.join('generated', 'quality-closure-repairs', safePathSegment(manifest.run_id ?? 'run'), 'provider_handoff')
  return {
    schema_version: 1,
    mode: CHARACTER_QUALITY_CLOSURE_PROVIDER_HANDOFF_MODE,
    status: 'needs_provider_or_manual_strip',
    run_id: manifest.run_id ?? null,
    preset: manifest.preset ?? profile.id,
    selected: {
      task_id: selected.task.task_id,
      item_id: selected.task.item_id,
      action: selected.task.action,
      requested_action: selected.task.requested_action ?? null,
      source_action: selected.task.source_action ?? selected.task.target?.source_action ?? null,
      source_layout: selected.task.source_layout ?? selected.task.target?.source_layout ?? null,
      issue: selected.task.issue,
      animation: selected.task.target?.animation ?? null,
      repair_mode: staticPose ? ACTION_REPAIR_MODE.STATIC_POSE : ACTION_REPAIR_MODE.ANIMATION_STRIP,
      frames: selectedFrames,
      derived_frames: selected.task.target?.derived_frames ?? [],
      target: selected.task.target,
      artifacts: selected.task.artifacts,
      provider_payload: selected.task.provider_payload,
      rank: selected.rank,
      prompt,
      expected_output: {
        kind: staticPose ? 'patched_normalized_sheet_png' : 'horizontal_animation_strip_png',
        cell_width: profile.frame.w,
        cell_height: profile.frame.h,
        cell_count: outputCellCount,
        target_cell_count: Math.max(1, selectedFrames.length),
        width: staticPose ? profile.sheet.w : profile.frame.w * outputCellCount,
        height: staticPose ? profile.sheet.h : profile.frame.h,
      },
      next_apply_command: applyCommand({ manifestPath, task: selected.task, outputDir: outputBase }),
    },
    candidates: ranked.map((entry, index) => ({
      rank: index + 1,
      task_id: entry.task.task_id,
      item_id: entry.task.item_id,
      action: entry.task.action,
      requested_action: entry.task.requested_action ?? null,
      source_action: entry.task.source_action ?? entry.task.target?.source_action ?? null,
      issue: entry.task.issue?.type ?? null,
      animation: entry.task.target?.animation ?? null,
      repair_mode: isStaticPoseRepairTask(entry.task) ? ACTION_REPAIR_MODE.STATIC_POSE : ACTION_REPAIR_MODE.ANIMATION_STRIP,
      frames: frameNumbers(entry.task),
      score: entry.rank.score,
      item_provider_task_count: entry.rank.item_provider_task_count,
      rationale: entry.rank.rationale,
    })),
    files: {
      handoff_json: path.join(outputBase, 'quality_closure_provider_handoff.json'),
      handoff_md: path.join(outputBase, 'quality_closure_provider_handoff.md'),
      selected_prompt: path.join(outputBase, 'selected_prompt.txt'),
      selected_contract: path.join(outputBase, 'selected_provider_contract.json'),
    },
    claim_boundary: 'This handoff selects one provider/manual repair task and writes prompt/contract files only. It does not call a provider or modify image assets.',
  }
}

export function renderQualityClosureProviderHandoffMarkdown(handoff = {}) {
  const selected = handoff.selected
  const lines = [
    '# Character Quality Closure Provider Handoff',
    '',
    `Status: \`${handoff.status ?? 'unknown'}\``,
    `Run: \`${handoff.run_id ?? 'n/a'}\``,
    `Preset: \`${handoff.preset ?? 'n/a'}\``,
    '',
    '## Claim Boundary',
    '',
    handoff.claim_boundary ?? '',
    '',
  ]
  if (!selected) {
    lines.push('No provider/manual task selected.')
    return `${lines.join('\n')}\n`
  }
  lines.push(
    '## Selected Task',
    '',
    `Task: \`${selected.task_id}\``,
    `Item: \`${selected.item_id ?? 'n/a'}\``,
    `Action: \`${selected.action}\``,
    `Animation: \`${selected.animation ?? 'n/a'}\``,
    `Frames: ${selected.frames.join(', ')}`,
    `Score: ${selected.rank.score}`,
    '',
    '### Why This One',
    '',
    ...selected.rank.rationale.map((item) => `- ${item}`),
    '',
    '### Expected Output',
    '',
    `Horizontal transparent PNG strip: ${selected.expected_output.width}x${selected.expected_output.height}px`,
    `${selected.expected_output.cell_count} cells of ${selected.expected_output.cell_width}x${selected.expected_output.cell_height}px`,
    '',
    '### Apply Command',
    '',
    '```bash',
    selected.next_apply_command,
    '```',
    '',
    '## Candidate Ranking',
    '',
    '| Rank | Task | Item | Action | Animation | Frames | Score |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...handoff.candidates.map((item) => (
      `| ${item.rank} | ${item.task_id} | ${item.item_id ?? 'n/a'} | ${item.action} | ${item.animation ?? 'n/a'} | ${item.frames.join(', ')} | ${item.score} |`
    ))
  )
  return `${lines.join('\n')}\n`
}
