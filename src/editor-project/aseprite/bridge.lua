-- Repository-owned headless Aseprite bridge script for BLOCK_3_EXTERNAL/r1.
-- Invoked only via execFile(asepriteExecutable, ['-b', '--script-param', ..., '--script', bridgeLuaPath]).

local mode = app.params["mode"]

local function aniDirFromString(dir)
  if dir == "reverse" then return AniDir.REVERSE end
  if dir == "pingpong" then return AniDir.PING_PONG end
  return AniDir.FORWARD
end

local function aniDirToString(dir)
  if dir == AniDir.FORWARD then return "forward" end
  if dir == AniDir.REVERSE then return "reverse" end
  if dir == AniDir.PING_PONG then return "pingpong" end
  return "unsupported"
end

if mode == "export" then
  local w = tonumber(app.params["width"])
  local h = tonumber(app.params["height"])
  local durationMs = tonumber(app.params["duration_ms"]) or 100
  local layerName = app.params["layer_name"] or "Layer 1"
  local hex = app.params["rgba_hex"] or ""
  local tagsJson = app.params["tags_json"] or "[]"
  local asePath = app.params["ase_path"]

  local spr = Sprite(w, h, ColorMode.RGB)
  spr.frames[1].duration = durationMs / 1000.0
  local layer = spr.layers[1]
  layer.name = layerName
  layer.isVisible = true
  layer.isEditable = true
  layer.blendMode = BlendMode.NORMAL
  layer.opacity = 255

  local img = Image(w, h, ColorMode.RGB)
  local idx = 1
  for y = 0, h - 1 do
    for x = 0, w - 1 do
      local r = tonumber(string.sub(hex, idx, idx + 1), 16) or 0
      local g = tonumber(string.sub(hex, idx + 2, idx + 3), 16) or 0
      local b = tonumber(string.sub(hex, idx + 4, idx + 5), 16) or 0
      local a = tonumber(string.sub(hex, idx + 6, idx + 7), 16) or 0
      idx = idx + 8
      img:drawPixel(x, y, app.pixelColor.rgba(r, g, b, a))
    end
  end
  spr:newCel(layer, 1, img, Point(0, 0))

  local okTags, tags = pcall(json.decode, tagsJson)
  if okTags and tags ~= nil then
    for i = 1, #tags do
      local t = tags[i]
      if t ~= nil and type(t.name) == "string" then
        local tag = spr:newTag(1, 1)
        tag.name = t.name
        tag.aniDir = aniDirFromString(t.direction)
      end
    end
  end

  spr:saveCopyAs(asePath)
  print("EXPORT_JSON:" .. json.encode({ ok = true, width = w, height = h }))

elseif mode == "inspect" then
  local asePath = app.params["ase_path"]
  local expectedW = tonumber(app.params["expected_width"]) or 64
  local expectedH = tonumber(app.params["expected_height"]) or 64

  local f = io.open(asePath, "rb")
  if not f then
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "artifact_not_found" }))
    return
  end
  local hdr = f:read(128)
  local totalLen = f:seek("end")
  if not hdr or #hdr < 128 or not totalLen or totalLen < 144 then
    f:close()
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "file_truncated" }))
    return
  end
  local function u16le(s, off)
    local b1, b2 = string.byte(s, off, off + 1)
    return b1 + b2 * 256
  end
  local function i16le(s, off)
    local u = u16le(s, off)
    return (u >= 32768) and (u - 65536) or u
  end
  local function u32le(s, off)
    local b1, b2, b3, b4 = string.byte(s, off, off + 3)
    return b1 + b2 * 256 + b3 * 65536 + b4 * 16777216
  end
  local hdrFileSize = u32le(hdr, 1)
  local hdrMagic = u16le(hdr, 5)
  local hdrFrames = u16le(hdr, 7)
  local hdrW = u16le(hdr, 9)
  local hdrH = u16le(hdr, 11)
  local hdrDepth = u16le(hdr, 13)
  local pxW, pxH = string.byte(hdr, 95, 96)
  if hdrMagic ~= 0xA5E0 then
    f:close()
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "invalid_magic" }))
    return
  end
  if hdrFileSize ~= totalLen then
    f:close()
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "file_truncated" }))
    return
  end
  if hdrW ~= expectedW or hdrH ~= expectedH then
    f:close()
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "canvas_dimensions", width = hdrW, height = hdrH }))
    return
  end
  if hdrFrames ~= 1 then
    f:close()
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "frame_count", frameCount = hdrFrames }))
    return
  end
  if hdrDepth ~= 32 then
    f:close()
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "color_mode", colorDepth = hdrDepth }))
    return
  end
  if (pxW ~= 0 and pxH ~= 0) and (pxW ~= 1 or pxH ~= 1) then
    f:close()
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "unsupported_metadata", pixelRatioW = pxW, pixelRatioH = pxH }))
    return
  end

  f:seek("set", 128)
  local frameHdr = f:read(16)
  if not frameHdr or #frameHdr < 16 then
    f:close()
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "file_truncated" }))
    return
  end
  local frameBytes = u32le(frameHdr, 1)
  local frameMagic = u16le(frameHdr, 5)
  local oldChunks = u16le(frameHdr, 7)
  local newChunks = u32le(frameHdr, 13)
  local chunkCount = (newChunks ~= 0) and newChunks or oldChunks
  if frameMagic ~= 0xF1FA or frameBytes < 16 or (128 + frameBytes) ~= totalLen then
    f:close()
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "file_truncated" }))
    return
  end
  local chunkOffset = 144
  local frameEnd = 128 + frameBytes
  local celChunkCount = 0
  local maxDecodedBytes = expectedW * expectedH * 4
  for _ = 1, chunkCount do
    if chunkOffset + 6 > frameEnd then
      f:close()
      print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "file_truncated" }))
      return
    end
    f:seek("set", chunkOffset)
    local chHdr = f:read(math.min(26, frameEnd - chunkOffset))
    if not chHdr or #chHdr < 6 then
      f:close()
      print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "file_truncated" }))
      return
    end
    local chunkSize = u32le(chHdr, 1)
    local chunkType = u16le(chHdr, 5)
    if chunkSize < 6 or (chunkOffset + chunkSize) > frameEnd then
      f:close()
      print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "file_truncated" }))
      return
    end
    if chunkType == 0x2005 then
      celChunkCount = celChunkCount + 1
      if chunkSize < 26 or #chHdr < 26 then
        f:close()
        print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "file_truncated" }))
        return
      end
      local celX = i16le(chHdr, 9)
      local celY = i16le(chHdr, 11)
      local celOpacity = string.byte(chHdr, 13)
      local celType = u16le(chHdr, 14)
      local celZIndex = i16le(chHdr, 16)
      local celW = u16le(chHdr, 23)
      local celH = u16le(chHdr, 25)
      local decodedBytes = celW * celH * 4
      if (celType ~= 0 and celType ~= 2) or celW < 1 or celH < 1 or celX < 0 or celY < 0
        or (celX + celW) > expectedW or (celY + celH) > expectedH or decodedBytes > maxDecodedBytes
        or celOpacity ~= 255 or celZIndex ~= 0 then
        f:close()
        print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "cel_structure" }))
        return
      end
    end
    chunkOffset = chunkOffset + chunkSize
  end
  f:close()
  if chunkOffset ~= frameEnd then
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "file_truncated" }))
    return
  end
  if celChunkCount ~= 1 then
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "cel_structure" }))
    return
  end

  local okOpen, spr = pcall(app.open, asePath)
  if not okOpen or not spr then
    print("INSPECT_JSON:" .. json.encode({ ok = false, rule = "invalid_file" }))
    return
  end

  local w = spr.width
  local h = spr.height
  local frameCount = #spr.frames
  local layerCount = #spr.layers
  local celCount = #spr.cels
  local sliceCount = #spr.slices
  local durationMs = (frameCount >= 1) and math.floor(spr.frames[1].duration * 1000 + 0.5) or 0

  local layerInfo = nil
  if layerCount >= 1 then
    local l1 = spr.layers[1]
    layerInfo = {
      name = l1.name or "",
      isImage = l1.isImage == true,
      isGroup = l1.isGroup == true,
      isTilemap = l1.isTilemap == true,
      isBackground = l1.isBackground == true,
      isTransparent = l1.isTransparent == true,
      isReference = l1.isReference == true,
      isVisible = l1.isVisible == true,
      isEditable = l1.isEditable == true,
      isContinuous = l1.isContinuous == true,
      blendMode = l1.isGroup and -1 or l1.blendMode,
      opacity = l1.isGroup and -1 or l1.opacity,
      data = l1.data or "",
      colorAlpha = l1.color and l1.color.alpha or 0,
      colorRed = l1.color and l1.color.red or 0,
      colorGreen = l1.color and l1.color.green or 0,
      colorBlue = l1.color and l1.color.blue or 0,
    }
  end

  local celInfo = nil
  local c1 = (celCount >= 1) and spr.cels[1] or nil
  if c1 then
    celInfo = {
      frameNumber = c1.frameNumber,
      x = c1.bounds.x,
      y = c1.bounds.y,
      width = c1.bounds.width,
      height = c1.bounds.height,
      opacity = c1.opacity,
      zIndex = c1.zIndex,
      data = c1.data or "",
      colorAlpha = c1.color and c1.color.alpha or 0,
      colorRed = c1.color and c1.color.red or 0,
      colorGreen = c1.color and c1.color.green or 0,
      colorBlue = c1.color and c1.color.blue or 0,
    }
  end

  local tags = {}
  for i = 1, #spr.tags do
    local t = spr.tags[i]
    tags[#tags + 1] = {
      name = t.name or "",
      fromFrame = t.fromFrame and t.fromFrame.frameNumber or 0,
      toFrame = t.toFrame and t.toFrame.frameNumber or 0,
      direction = aniDirToString(t.aniDir),
      aniDir = t.aniDir,
      repeats = t.repeats or 0,
      data = t.data or "",
      colorAlpha = t.color and t.color.alpha or 0,
      colorRed = t.color and t.color.red or 0,
      colorGreen = t.color and t.color.green or 0,
      colorBlue = t.color and t.color.blue or 0,
    }
  end

  local rgbaHex = nil
  if w == expectedW and h == expectedH and spr.colorMode == ColorMode.RGB and frameCount == 1 and layerCount == 1 and celCount == 1 and c1 and layerInfo and layerInfo.isImage and not layerInfo.isTilemap then
    local bx, by, bw, bh = c1.bounds.x, c1.bounds.y, c1.bounds.width, c1.bounds.height
    if bx >= 0 and by >= 0 and (bx + bw) <= w and (by + bh) <= h then
      local cimg = c1.image
      local out = {}
      for y = 0, h - 1 do
        for x = 0, w - 1 do
          if x >= bx and x < (bx + bw) and y >= by and y < (by + bh) then
            local px = cimg:getPixel(x - bx, y - by)
            out[#out + 1] = string.format(
              "%02x%02x%02x%02x",
              app.pixelColor.rgbaR(px),
              app.pixelColor.rgbaG(px),
              app.pixelColor.rgbaB(px),
              app.pixelColor.rgbaA(px)
            )
          else
            out[#out + 1] = "00000000"
          end
        end
      end
      rgbaHex = table.concat(out)
    end
  end

  print("INSPECT_JSON:" .. json.encode({
    ok = true,
    width = w,
    height = h,
    colorMode = spr.colorMode,
    frameCount = frameCount,
    layerCount = layerCount,
    celCount = celCount,
    sliceCount = sliceCount,
    spriteData = spr.data or "",
    pixelRatioW = spr.pixelRatio.width,
    pixelRatioH = spr.pixelRatio.height,
    durationMs = durationMs,
    layer = layerInfo,
    cel = celInfo,
    tags = tags,
    rgba_hex = rgbaHex,
  }))

elseif mode == "batch_edit" then
  local asePath = app.params["ase_path"]
  local opsJson = app.params["ops_json"] or "{}"
  local spr = app.open(asePath)
  local spec = json.decode(opsJson)

  if spec.resize then
    spr:resize(spec.resize.w, spec.resize.h)
  end
  if spec.addFrame then
    spr:newEmptyFrame()
  end
  if spec.addLayer then
    spr:newLayer()
  end
  if spec.addGroup then
    spr:newGroup()
  end
  if spec.deleteCel and #spr.cels >= 1 then
    spr:deleteCel(spr.cels[1])
  end
  if spec.setLayerVisible ~= nil then
    spr.layers[1].isVisible = spec.setLayerVisible
  end
  if spec.setLayerEditable ~= nil then
    spr.layers[1].isEditable = spec.setLayerEditable
  end
  if spec.setLayerContinuous ~= nil then
    spr.layers[1].isContinuous = spec.setLayerContinuous
  end
  if spec.setLayerOpacity ~= nil then
    spr.layers[1].opacity = spec.setLayerOpacity
  end
  if spec.setLayerBlendMode ~= nil then
    spr.layers[1].blendMode = spec.setLayerBlendMode
  end
  if spec.setLayerName ~= nil then
    spr.layers[1].name = spec.setLayerName
  end
  if spec.setLayerData ~= nil then
    spr.layers[1].data = spec.setLayerData
  end
  if spec.setLayerColor ~= nil then
    spr.layers[1].color = Color{ r = spec.setLayerColor[1], g = spec.setLayerColor[2], b = spec.setLayerColor[3], a = spec.setLayerColor[4] or 255 }
  end
  if spec.setCelData ~= nil and #spr.cels >= 1 then
    spr.cels[1].data = spec.setCelData
  end
  if spec.setCelColor ~= nil and #spr.cels >= 1 then
    spr.cels[1].color = Color{ r = spec.setCelColor[1], g = spec.setCelColor[2], b = spec.setCelColor[3], a = spec.setCelColor[4] or 255 }
  end
  if spec.setDurationMs ~= nil then
    spr.frames[1].duration = spec.setDurationMs / 1000.0
  end
  if spec.setSpriteData ~= nil then
    spr.data = spec.setSpriteData
  end
  if spec.addSlice then
    spr:newSlice(Rectangle(0, 0, 8, 8))
  end
  if spec.addTag then
    local t = spr:newTag(spec.addTag.fromFrame or 1, spec.addTag.toFrame or 1)
    t.name = spec.addTag.name or "Tag"
    if spec.addTag.repeats then t.repeats = spec.addTag.repeats end
    if spec.addTag.data then t.data = spec.addTag.data end
    if spec.addTag.color then
      t.color = Color{ r = spec.addTag.color[1], g = spec.addTag.color[2], b = spec.addTag.color[3], a = spec.addTag.color[4] or 255 }
    end
  end
  if spec.setTagColor and #spr.tags >= 1 then
    spr.tags[1].color = Color{ r = spec.setTagColor[1], g = spec.setTagColor[2], b = spec.setTagColor[3], a = spec.setTagColor[4] or 255 }
  end
  if spec.fillRect ~= nil and #spr.cels >= 1 then
    local c1 = spr.cels[1]
    local img = c1.image:clone()
    local bx, by = c1.bounds.x, c1.bounds.y
    local r = spec.fillRect.rect
    local c = spec.fillRect.color
    local px = app.pixelColor.rgba(c[1], c[2], c[3], c[4])
    for y = r.y, r.y + r.h - 1 do
      for x = r.x, r.x + r.w - 1 do
        img:drawPixel(x - bx, y - by, px)
      end
    end
    c1.image = img
  end
  if spec.pixels ~= nil and #spr.cels >= 1 then
    local c1 = spr.cels[1]
    local img = c1.image:clone()
    local bx, by = c1.bounds.x, c1.bounds.y
    for i = 1, #spec.pixels do
      local p = spec.pixels[i]
      local c = p.color
      local r = c and c[1] or p.r or 0
      local g = c and c[2] or p.g or 0
      local b = c and c[3] or p.b or 0
      local a = c and c[4] or p.a or 255
      img:drawPixel(p.x - bx, p.y - by, app.pixelColor.rgba(r, g, b, a))
    end
    c1.image = img
  end
  if spec.cropCel ~= nil and #spr.cels >= 1 then
    local c1 = spr.cels[1]
    local oldImg = c1.image:clone()
    local obx, oby = c1.bounds.x, c1.bounds.y
    local cx, cy, cw, ch = spec.cropCel.x, spec.cropCel.y, spec.cropCel.w, spec.cropCel.h
    local subImg = Image(cw, ch, ColorMode.RGB)
    local fillCol = spec.cropCel.color
    local fillPx = fillCol and app.pixelColor.rgba(fillCol[1], fillCol[2], fillCol[3], fillCol[4] or 255) or nil
    for y = 0, ch - 1 do
      for x = 0, cw - 1 do
        if fillPx ~= nil then
          subImg:drawPixel(x, y, fillPx)
        else
          local sx = (cx + x) - obx
          local sy = (cy + y) - oby
          if sx >= 0 and sx < oldImg.width and sy >= 0 and sy < oldImg.height then
            subImg:drawPixel(x, y, oldImg:getPixel(sx, sy))
          end
        end
      end
    end
    spr:newCel(spr.layers[1], 1, subImg, Point(cx, cy))
  end

  spr:saveCopyAs(asePath)
  print("BATCH_EDIT_JSON:" .. json.encode({ ok = true }))
end
