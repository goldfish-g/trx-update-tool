-- Lets a script written for an older TRX run on the current one.
--
-- The level converter writes this module into a converted game, and starts
-- each script the game brought with
--
--   local trx, require = require(trx.mod.current.name .. ".trx_compat")(<release>)
--
-- where <release> is the TRX 1.x the game was made for: 9 for TRX 1.9. The
-- script then reaches the API as that release had it. What TRX has changed
-- since (docs/trx/MIGRATING.md) is translated as the script reads and calls
-- it; the rest reaches the engine as it is. Called with no release, it hands
-- back the engine's own trx, and a require that sets up the shipped modules
-- once however many scripts ask for them.

local engine = trx
local engine_require = require

-- The game's own directory, under whatever name it was installed.
local GAME_DIR = engine.mod.current.name

-- Filled in by the converter.
-- Object keys TRX 1.11 renamed, old key to new; `older` lists the renames of
-- earlier releases for this game as { release, old key, new key }.
local OBJECT_RENAMES = { --[[OBJECT_RENAMES]] }
-- The scripts a game required by their file name before TRX 1.10, which the
-- converter moved into the game's modules directory: old name to the new
-- one within the game's own directory.
local MODULE_RENAMES = { --[[MODULE_RENAMES]] }

-- The spelling a setting's value had before TRX 1.11 read every separator as
-- `_`. Values that were spelled with `_` already are left out.
local OLD_ENUM_SPELLINGS = {}
for _, value in ipairs({
  "16:10", "16:9", "4:3", "all-rings", "boss-only", "bottom-center",
  "bottom-left", "bottom-right", "draw-and-holster", "draw-only", "full-lock",
  "main-ring", "monochrome-cool", "monochrome-warm", "multi-sweep", "new-game",
  "new-games", "no-lock", "non-ambient", "on-completion", "pattern-static",
  "pattern-wave", "roll-pitch", "semi-lock", "single-sweep", "top-center",
  "top-left", "top-right", "transparent-dark",
}) do
  OLD_ENUM_SPELLINGS[(value:gsub("[-:]", "_"))] = value
end

-------------------------------------------------------------------------------
-- The shipped modules a game sets up once
-------------------------------------------------------------------------------

-- The functions that set a module up, which a game composed of its own script
-- and the one it extends may otherwise call twice.
local ONCE = {
  ["common.ui.hud.overlay"] = { setup = true },
  ["common.ui.hud.assault"] = { setup = true },
  ["common.save_crystal"] = { initialise = true },
  ["common.ngplus"] = { initialise = true },
  ["common.water_color"] = { declare = true },
  ["tr3.quest_items"] = { initialise = true },
}

-- Modules TRX 1.12 moved, and whether the old one set itself up as it was
-- required.
local MOVED_MODULES = {
  ["common.overlay"] = { name = "common.ui.hud.overlay", setup = true },
  ["common.overlay.photo_mode"] = { name = "common.ui.hud.overlay.photo_mode" },
  ["common.assault"] = { name = "common.ui.hud.assault", setup = true },
  ["common.legend"] = { name = "common.ui.hud.legend" },
}

local once_done = {}
local once_modules = {}

-- The module with its set-up functions running once, for every script.
local function guarded(name, module)
  local fns = ONCE[name]
  if fns == nil or type(module) ~= "table" then
    return module
  end
  local shown = once_modules[name]
  if shown ~= nil then
    return shown
  end
  shown = setmetatable({}, {
    __index = function(_, key)
      local value = module[key]
      if fns[key] and type(value) == "function" then
        return function(...)
          local id = name .. "." .. key
          if once_done[id] then
            return nil
          end
          once_done[id] = true
          return value(...)
        end
      end
      return value
    end,
    __newindex = module,
  })
  once_modules[name] = shown
  return shown
end

local function guarded_require(name)
  local lower = type(name) == "string" and name:lower() or name
  return guarded(lower, engine_require(name))
end

-------------------------------------------------------------------------------
-- The membrane: what a script sees in place of the engine's values
-------------------------------------------------------------------------------

local function build(from)
  -- Whether the script predates TRX 1.<release>.
  local function older(release)
    return from < release
  end

  local GAME = engine.game.version

  -- Set while a handler runs that, before TRX 1.10, ran before the level's
  -- items were set up.
  local early = false
  local early_is_save = false

  local wrap, unwrap

  -- Proxies by the engine value they stand for, and the other way round.
  local proxy_of = setmetatable({}, { __mode = "k" })
  local value_of = setmetatable({}, { __mode = "k" })
  -- Engine functions as a script sees them, and script functions as the
  -- engine sees them, each way round.
  local outward = setmetatable({}, { __mode = "k" })
  local outward_from = setmetatable({}, { __mode = "k" })
  local inward = setmetatable({}, { __mode = "k" })
  local inward_from = setmetatable({}, { __mode = "k" })

  local function wrap_all(...)
    local n = select("#", ...)
    if n == 0 then
      return
    elseif n == 1 then
      return (wrap((...)))
    end
    local values = table.pack(...)
    for i = 1, n do
      values[i] = wrap(values[i])
    end
    return table.unpack(values, 1, n)
  end

  local function unwrap_all(...)
    local n = select("#", ...)
    if n == 0 then
      return
    elseif n == 1 then
      return (unwrap((...)))
    end
    local values = table.pack(...)
    for i = 1, n do
      values[i] = unwrap(values[i])
    end
    return table.unpack(values, 1, n)
  end

  -- A table the script built is handed to the engine as it is, unless it
  -- holds a proxy or a function, which the engine needs as its own.
  local function needs_copy(tbl, seen)
    if seen[tbl] then
      return false
    end
    seen[tbl] = true
    local function holds(part)
      local kind = type(part)
      if kind == "function" then
        return true
      elseif kind == "table" then
        return value_of[part] ~= nil
          or (getmetatable(part) == nil and needs_copy(part, seen))
      end
      return false
    end
    for key, value in next, tbl do
      if holds(key) or holds(value) then
        return true
      end
    end
    return false
  end

  local function unwrap_table(tbl, copies)
    local copy = copies[tbl]
    if copy ~= nil then
      return copy
    end
    copy = {}
    copies[tbl] = copy
    for key, value in next, tbl do
      local function convert(part)
        if type(part) == "table" and value_of[part] == nil
          and getmetatable(part) == nil then
          return unwrap_table(part, copies)
        end
        return unwrap(part)
      end
      copy[convert(key)] = convert(value)
    end
    return copy
  end

  function unwrap(value)
    local kind = type(value)
    if kind == "table" then
      local engine_value = value_of[value]
      if engine_value ~= nil then
        return engine_value
      end
      if getmetatable(value) == nil and needs_copy(value, {}) then
        return unwrap_table(value, {})
      end
      return value
    elseif kind == "function" then
      local engine_fn = outward_from[value]
      if engine_fn ~= nil then
        return engine_fn
      end
      local fn = inward[value]
      if fn == nil then
        fn = function(...)
          return unwrap_all(value(wrap_all(...)))
        end
        inward[value] = fn
        inward_from[fn] = value
      end
      return fn
    end
    return value
  end

  -- What changed, by where the script reaches it: a module by its path, a
  -- handle by the type it reports. Each hook works on engine values and
  -- returns engine values; the membrane converts on the way out.
  --   get[key](value) / set[key](value, new) for a field,
  --   index(value, key) -> found, result / newindex(value, key, new) -> done,
  --   len(value), call(value, ...), and self_arg for a module whose
  --   functions a script calls with a colon.
  local paths = {}
  local types = {}
  local any = { get = {} }

  local function hooks_for(path)
    local hooks = paths[path]
    if hooks == nil then
      hooks = { get = {}, set = {} }
      paths[path] = hooks
    end
    return hooks
  end

  local function type_hooks(name)
    local hooks = types[name]
    if hooks == nil then
      hooks = { get = {}, set = {} }
      types[name] = hooks
    end
    return hooks
  end

  -- A handle's protected metatable names its type.
  local function handle_type(value)
    local kind = type(value)
    if kind ~= "userdata" and kind ~= "table" then
      return nil
    end
    local name = getmetatable(value)
    return type(name) == "string" and name or nil
  end

  local function child_path(path, key)
    if path ~= nil and type(key) == "string" then
      return path .. "." .. key
    end
    return nil
  end

  -- A handle reads nil for a field it does not have, as the old ones did,
  -- where the current ones raise.
  local function index(value, key)
    return value[key]
  end

  local function read(value, key, is_handle)
    if is_handle then
      local ok, result = pcall(index, value, key)
      if ok then
        return result
      end
      return nil
    end
    return value[key]
  end

  local function binary(op)
    return function(a, b)
      return wrap(op(unwrap(a), unwrap(b)))
    end
  end

  local function make_proxy(value, path)
    local tname = handle_type(value)
    local hooks = (path and paths[path]) or (tname and types[tname]) or nil
    local is_handle = tname ~= nil
    local proxy = {}
    local mt = {}

    mt.__index = function(_, key)
      local result
      local getter = hooks and hooks.get[key]
      if getter then
        result = getter(value)
      else
        local found = false
        if hooks and hooks.index then
          found, result = hooks.index(value, key)
        end
        if not found then
          result = read(value, key, is_handle)
          if result == nil and any.get[key] then
            result = any.get[key](value)
          end
        end
      end
      local shown = wrap(result, child_path(path, key))
      if hooks and hooks.self_arg and type(shown) == "function" then
        -- trx.inventory:give(...) once took a colon; the module itself is not
        -- an argument now.
        local fn = shown
        return function(first, ...)
          if first == proxy then
            return fn(...)
          end
          return fn(first, ...)
        end
      end
      return shown
    end

    mt.__newindex = function(_, key, new)
      local setter = hooks and hooks.set[key]
      if setter then
        setter(value, unwrap(new))
        return
      end
      if hooks and hooks.newindex and hooks.newindex(value, key, unwrap(new)) then
        return
      end
      value[key] = unwrap(new)
    end

    mt.__len = function()
      if hooks and hooks.len then
        return hooks.len(value)
      end
      return #value
    end

    mt.__call = function(_, ...)
      if hooks and hooks.call then
        return wrap_all(hooks.call(value, unwrap_all(...)))
      end
      return wrap_all(value(unwrap_all(...)))
    end

    mt.__pairs = function()
      local fn, state, control = pairs(value)
      return function()
        local key, item = fn(state, control)
        control = key
        if key == nil then
          return nil
        end
        return wrap(key), wrap(item, child_path(path, key))
      end
    end

    mt.__tostring = function()
      return tostring(value)
    end
    mt.__eq = binary(function(a, b)
      return a == b
    end)
    mt.__lt = binary(function(a, b)
      return a < b
    end)
    mt.__le = binary(function(a, b)
      return a <= b
    end)
    mt.__add = binary(function(a, b)
      return a + b
    end)
    mt.__sub = binary(function(a, b)
      return a - b
    end)
    mt.__mul = binary(function(a, b)
      return a * b
    end)
    mt.__div = binary(function(a, b)
      return a / b
    end)
    mt.__mod = binary(function(a, b)
      return a % b
    end)
    mt.__pow = binary(function(a, b)
      return a ^ b
    end)
    mt.__idiv = binary(function(a, b)
      return a // b
    end)
    mt.__band = binary(function(a, b)
      return a & b
    end)
    mt.__bor = binary(function(a, b)
      return a | b
    end)
    mt.__bxor = binary(function(a, b)
      return a ~ b
    end)
    mt.__shl = binary(function(a, b)
      return a << b
    end)
    mt.__shr = binary(function(a, b)
      return a >> b
    end)
    mt.__concat = binary(function(a, b)
      return a .. b
    end)
    mt.__unm = function()
      return wrap(-value)
    end
    mt.__bnot = function()
      return wrap(~value)
    end

    setmetatable(proxy, mt)
    proxy_of[value] = proxy
    value_of[proxy] = value
    return proxy
  end

  function wrap(value, path)
    local kind = type(value)
    if kind == "function" then
      local script_fn = inward_from[value]
      if script_fn ~= nil then
        return script_fn
      end
      local fn = outward[value]
      if fn == nil then
        fn = function(...)
          return wrap_all(value(unwrap_all(...)))
        end
        outward[value] = fn
        outward_from[fn] = value
      end
      return fn
    elseif kind == "table" or kind == "userdata" then
      if value_of[value] ~= nil then
        return value
      end
      local proxy = proxy_of[value]
      if proxy == nil then
        proxy = make_proxy(value, path)
      end
      return proxy
    end
    return value
  end

  -- A table of functions, by key, that the script reaches in place of the
  -- engine's module. Anything else falls through to the engine's.
  local function extend(path, fields)
    local hooks = hooks_for(path)
    for key, fn in pairs(fields) do
      hooks.get[key] = function()
        return fn
      end
    end
  end

  local function alias(path, names)
    local hooks = hooks_for(path)
    local previous = hooks.index
    hooks.index = function(value, key)
      local now = names[key]
      if now ~= nil then
        return true, value[now]
      end
      if previous then
        return previous(value, key)
      end
      return false
    end
  end

  local function join(...)
    local parts = table.pack(...)
    for i = 1, parts.n do
      parts[i] = tostring(parts[i])
    end
    return table.concat(parts, " ", 1, parts.n)
  end

  -----------------------------------------------------------------------------
  -- Objects: keys renamed in 1.2 and 1.11
  -----------------------------------------------------------------------------

  local function current_key(key)
    if type(key) ~= "string" then
      return key
    end
    local lower = key:lower()
    if older(2) then
      lower = lower:gsub("^o_", "")
    end
    for _, rename in ipairs(OBJECT_RENAMES.older or {}) do
      if older(rename[1]) and lower == rename[2] then
        lower = rename[3]
      end
    end
    if older(11) then
      lower = OBJECT_RENAMES[lower] or lower
    end
    return lower
  end

  if older(11) then
    -- Every rename the table holds is older than 1.11.
    for _, path in ipairs({ "trx.catalog.objects", "trx.objects" }) do
      local hooks = hooks_for(path)
      hooks.index = function(value, key)
        if type(key) ~= "string" then
          return false
        end
        local now = current_key(key)
        if now == key then
          return false
        end
        return true, value[now]
      end
    end
  end

  -----------------------------------------------------------------------------
  -- TRX 1.0 and 1.1
  -----------------------------------------------------------------------------

  if older(2) then
    alias("trx.lara", { exposure_timer = "exposure_bar" })
    hooks_for("trx.lara").set.exposure_timer = function(value, new)
      value.exposure_bar = new
    end
    alias("trx.music.PlayMode", {
      ALWAYS = "ONCE",
      LOOPED = "LOOP",
      TRACKED = "NO_REPEAT",
      DELAYED = "DELAY",
    })
  end

  -- TRX 1.0 made the monks of TR2 Lara's allies and the bandits their
  -- enemies everywhere. Since 1.1 a level says so.
  if older(1) and GAME == 2 then
    engine.events.on_game_start(function()
      local objects = engine.catalog.objects
      for _, key in ipairs({ "monk_1", "monk_2", "monk_3" }) do
        local ok, id = pcall(function()
          return objects[key]
        end)
        if ok and id ~= nil then
          engine.creatures.add_ally(id)
        end
      end
      for _, key in ipairs({ "bandit_1", "bandit_2" }) do
        local ok, id = pcall(function()
          return objects[key]
        end)
        if ok and id ~= nil then
          engine.creatures.add_ally_target(id)
        end
      end
    end)
  end

  -----------------------------------------------------------------------------
  -- TRX 1.6 and 1.7
  -----------------------------------------------------------------------------

  if older(7) then
    local item = type_hooks("ITEM")
    item.set.max_hit_points = function(value, new)
      value.properties.max_hit_points = new
    end
  end

  if older(8) then
    hooks_for("trx").get.assault_stats = function(value)
      return value.assault.stats
    end
  end

  -----------------------------------------------------------------------------
  -- TRX 1.9: the API before it was rewritten
  -----------------------------------------------------------------------------

  if older(10) then
    -- Items and rooms counted from 1.
    local item = type_hooks("ITEM")
    item.get.idx = function(value)
      return value.num + 1
    end
    item.get.index = item.get.idx
    item.get.anim = function(value)
      return value.anim_num
    end
    item.set.anim = function(value, new)
      value.anim_num = new
    end
    item.get.frame = function(value)
      return value.frame_num
    end
    item.set.frame = function(value, new)
      value.frame_num = new
    end
    item.get.room_num = function(value)
      local num = value.room_num
      return num ~= nil and num + 1 or nil
    end
    item.get.status = function(value)
      if value.is_finished then
        return 2
      elseif value.is_visible == false then
        return 3
      elseif value.is_simulated then
        return 1
      end
      return 0
    end
    item.get.flags = function(value)
      local flags = (value.trigger_mask or 0) << 9
      if value.is_one_shot then
        flags = flags | 0x100
      end
      if value.is_reversed then
        flags = flags | 0x4000
      end
      if value.is_killed then
        flags = flags | 0x8000
      end
      return flags
    end
    item.set.object_id = function(value, new)
      local ok, err = pcall(function()
        value.object_id = new
      end)
      if not ok then
        engine.log.warning(
          "an item's object can no longer change: " .. tostring(err)
        )
      end
    end

    local Status = { INACTIVE = 0, ACTIVE = 1, DEACTIVATED = 2, INVISIBLE = 3 }

    local items_fn = {
      get = function(key)
        if type(key) == "number" then
          return engine.items[key - 1]
        end
        return engine.items[key]
      end,
    }
    local function find(query, first_only)
      local matches = {}
      if query == nil then
        if first_only then
          return nil
        end
        return matches
      end
      for num = 0, engine.items.count() - 1 do
        local found = engine.items[num]
        if found ~= nil
          and (query.object_id == nil or found.object_id == query.object_id)
          and (query.room_num == nil or found.room_num + 1 == query.room_num)
        then
          if first_only then
            return found
          end
          matches[#matches + 1] = found
        end
      end
      if first_only then
        return nil
      end
      return matches
    end
    items_fn.find = function(query)
      return find(query, false)
    end
    items_fn.first = function(query)
      return find(query, true)
    end

    local items = hooks_for("trx.items")
    items.index = function(value, key)
      if type(key) == "number" then
        return true, value[key - 1]
      elseif key == "fn" then
        return true, items_fn
      elseif key == "find" or key == "first" then
        return true, items_fn[key]
      elseif key == "Status" then
        return true, Status
      end
      return false
    end
    items.len = function(value)
      return value.count()
    end

    local room = type_hooks("ROOM")
    room.get.num = function(value)
      return value.num + 1
    end
    room.get.idx = room.get.num
    for _, flag in ipairs({ "underwater", "wind", "damaging", "cold" }) do
      room.set[flag] = function(value, new)
        value[flag] = not not new
      end
    end

    local rooms_fn = {
      get = function(key)
        if type(key) == "number" then
          return engine.rooms[key - 1]
        end
        return engine.rooms[key]
      end,
      flip = engine.rooms.flip,
      flip_effect = engine.rooms.flip_effect,
      FlipStatus = engine.rooms.FlipStatus,
      Room = engine.rooms.Room,
    }
    local rooms = hooks_for("trx.rooms")
    rooms.index = function(value, key)
      if type(key) == "number" then
        return true, value[key - 1]
      elseif key == "fn" then
        return true, rooms_fn
      end
      return false
    end
    rooms.len = function(value)
      return value.count()
    end

    local camera = hooks_for("trx.camera")
    for _, field in ipairs({ "room_num", "target_room_num" }) do
      camera.get[field] = function(value)
        local num = value[field]
        return num ~= nil and num + 1 or nil
      end
    end

    -- Levels: the gym came first, and a level had a name.
    type_hooks("GF_LEVEL").get.name = function(value)
      return value.title
    end
    local function main_levels()
      local gym = engine.game.gym
      local list = engine.game.levels
      return setmetatable({}, {
        __index = function(_, i)
          if type(i) ~= "number" then
            return nil
          end
          if gym ~= nil then
            if i == 1 then
              return gym
            end
            return list[i - 1]
          end
          return list[i]
        end,
        __len = function()
          return #list + (gym ~= nil and 1 or 0)
        end,
      })
    end
    local settings = setmetatable({}, {
      __index = function(_, key)
        local ok, result = pcall(engine.config.get, "flow." .. key)
        if ok then
          if type(result) == "boolean" then
            return result and "true" or "false"
          elseif math.type(result) == "integer" then
            return string.format("%d", result)
          end
          return result
        end
        return nil
      end,
      __newindex = function(_, key, new)
        if new == "true" then
          new = true
        elseif new == "false" then
          new = false
        end
        engine.config.override("flow." .. key, new)
      end,
    })
    local game = hooks_for("trx.game")
    game.get.levels = main_levels
    game.get.settings = function()
      return settings
    end
    game.get.play_level = function()
      return function(num)
        local gym = engine.game.gym
        if gym ~= nil then
          if num == 1 then
            return engine.game.play_gym()
          end
          num = num - 1
        end
        local level = engine.game.levels[num]
        if level == nil then
          error("invalid level number: " .. tostring(num), 2)
        end
        return engine.game.play_level(level.num)
      end
    end
    for _, kind in ipairs({ "cutscene", "demo" }) do
      local list = kind .. "s"
      game.get["play_" .. kind] = function()
        return function(num)
          local level = engine.game[list][num]
          if level == nil then
            error("invalid " .. kind .. " number: " .. tostring(num), 2)
          end
          return engine.game["play_" .. kind](level.num)
        end
      end
    end

    -- Music and sound took the level's own slot.
    extend("trx.music", {
      play = function(num, opts)
        local track = engine.music.tracks[num]
        if track == nil then
          error("invalid track: " .. tostring(num), 2)
        end
        track:play(opts)
      end,
      play_track = function(num, opts)
        local track = engine.music.tracks[num]
        if track == nil then
          error("invalid track: " .. tostring(num), 2)
        end
        track:play(opts)
      end,
      get_track = function()
        local track = engine.music.current_track
        return track and track.num
      end,
      get_looped_track = function()
        local track = engine.music.looped_track
        return track and track.num
      end,
      available_tracks = function()
        local nums = {}
        for num in pairs(engine.music.tracks) do
          nums[#nums + 1] = num
        end
        table.sort(nums)
        return nums
      end,
      is_available = function(num)
        return engine.music.tracks[num] ~= nil
      end,
    })
    extend("trx.sound", {
      play = function(num, opts)
        local sample = engine.sound.samples[num]
        if sample ~= nil then
          sample:play(opts)
        end
      end,
      stop = function(num)
        local sample = engine.sound.samples[num]
        if sample ~= nil then
          sample:stop()
        end
      end,
      is_available = function(num)
        return engine.sound.samples[num] ~= nil
      end,
    })

    -- Lara's extra animation was a number, her meshes lower case tables.
    local lara = hooks_for("trx.lara")
    lara.get.extra_anim = function(value)
      if value.extra_anim then
        return value.item.anim_num
      end
      return -1
    end
    local function upper_enum(enum)
      return setmetatable({}, {
        __index = function(_, key)
          if type(key) == "string" then
            return enum[key:upper()]
          end
          return nil
        end,
      })
    end
    lara.get.mesh = function(value)
      return upper_enum(value.Mesh)
    end
    lara.get.extra_mesh = function(value)
      return upper_enum(value.ExtraMesh)
    end

    hooks_for("trx").get.pickup = function(value)
      return { Mode = value.items.PickupMode }
    end

    -- An object's maximum hit points, written before its items were set up,
    -- was what they started with. The items are set up by the time such a
    -- handler runs now, so the ones still at the old maximum follow.
    type_hooks("OBJECT").get.properties = function(object)
      local properties = object.properties
      return setmetatable({}, {
        __index = function(_, key)
          return properties[key]
        end,
        __newindex = function(_, key, new)
          local before = properties[key]
          properties[key] = new
          if key ~= "max_hit_points" or not early or early_is_save then
            return
          end
          for num = 0, engine.items.count() - 1 do
            local found = engine.items[num]
            if found ~= nil and found.hit_points == before
              and engine.objects[found.object_id] == object then
              found.properties.max_hit_points = new
            end
          end
        end,
        __pairs = function()
          return pairs(properties)
        end,
      })
    end

    -- The console took any number of arguments, and named its log levels.
    local console_log = hooks_for("trx.console.log")
    console_log.call = function(value, ...)
      return value(join(...))
    end
    console_log.get.generic = function(value)
      return function(level, ...)
        return value.generic(level, join(...))
      end
    end
    for _, name in ipairs({ "info", "warn", "warning", "error", "debug" }) do
      console_log.get[name] = function(value)
        return function(...)
          return value[name](join(...))
        end
      end
    end
    console_log.get.LogLevel = function()
      return engine.log.LogLevel
    end
    local log = hooks_for("trx.log")
    for _, name in ipairs({ "info", "warn", "warning", "error", "debug" }) do
      log.get[name] = function(value)
        return function(...)
          return value[name](join(...))
        end
      end
    end
  end

  -----------------------------------------------------------------------------
  -- Settings: strings until 1.10, hex colors and dashes until 1.11
  -----------------------------------------------------------------------------

  if older(11) then
    local function old_value(key, result)
      local ok, shape = pcall(engine.config.describe, key)
      local kind = ok and shape and shape.kind or nil
      if kind == "color" and result ~= nil and type(result) ~= "string" then
        result = result.hex
      elseif kind == "enum" and type(result) == "string" then
        result = OLD_ENUM_SPELLINGS[result] or result
      end
      if older(10) then
        if type(result) == "boolean" then
          result = result and "true" or "false"
        elseif math.type(result) == "integer" then
          result = string.format("%d", result)
        elseif type(result) == "number" then
          if ok and shape and shape.percent then
            result = string.format("%.0f%%", result * 100)
          else
            result = string.format("%.2f", result)
          end
        end
      end
      return result
    end
    extend("trx.config", {
      get = function(key)
        return old_value(key, engine.config.get(key))
      end,
      list = function()
        local values = {}
        for key, result in pairs(engine.config.list()) do
          values[key] = old_value(key, result)
        end
        return values
      end,
    })
  end

  -----------------------------------------------------------------------------
  -- Events
  -----------------------------------------------------------------------------

  do
    local events = hooks_for("trx.events")
    local listeners = {}
    -- The names TRX 1.2 gave the level and control events.
    local renamed = {}
    if older(2) then
      renamed = {
        on_level_init = "before_level_file",
        on_level_start = "after_level_file",
        on_level_load = "after_level_state",
        on_control = "before_control",
        on_control_post = "after_control",
      }
    end

    -- Before 1.10 a hook handed back a number, and detach took it.
    local function attached(listener)
      if older(10) and listener ~= nil and type(listener) ~= "number" then
        listeners[listener.id] = listener
        return listener.id
      end
      return listener
    end

    local function level_num()
      local level = engine.game.current_level
      return level and level.num
    end

    local replaced = {}
    if older(10) then
      local function on_start(before_items)
        return function(callback)
          return attached(engine.events.on_game_start(function(is_save)
            if not before_items then
              return callback(level_num())
            end
            early, early_is_save = true, is_save
            local result = table.pack(pcall(callback, level_num()))
            early, early_is_save = false, false
            if not result[1] then
              error(result[2], 0)
            end
            return table.unpack(result, 2, result.n)
          end))
        end
      end
      for _, name in ipairs({ "before_level_file", "after_level_file", "before_item_setup" }) do
        replaced[name] = on_start(true)
      end
      for _, name in ipairs({ "after_item_setup", "after_level_state" }) do
        replaced[name] = on_start(false)
      end
      replaced.on_game_start = function(callback)
        return attached(engine.events.on_game_start(function(is_save)
          return callback(level_num(), is_save)
        end))
      end
      replaced.detach = function(listener)
        if type(listener) == "number" then
          local found = listeners[listener]
          listeners[listener] = nil
          if found ~= nil then
            return engine.events.detach(found)
          end
          return nil
        end
        return engine.events.detach(listener)
      end
    end
    if older(11) then
      for _, name in ipairs({
        "on_cutscene_start", "on_cutscene_end", "on_cutscene_frame",
      }) do
        replaced[name] = function(callback)
          return attached(engine.events[name](function(cutscene, ...)
            return callback(cutscene and cutscene.num, ...)
          end))
        end
      end
    end
    if older(12) then
      replaced.on_ui_draw = function(callback)
        return attached(engine.ui.on_reserve(callback))
      end
      replaced.on_ui_paint = function(callback)
        return attached(engine.ui.on_paint(callback))
      end
    end

    local EventType = {}
    local event_types = {}
    events.index = function(value, key)
      key = renamed[key] or key
      if older(10) and key == "EventType" then
        return true, EventType
      end
      local fn = replaced[key]
      if fn == nil then
        if not older(10) or key == "detach" then
          return false
        end
        local hook = value[key]
        if type(hook) ~= "function" then
          return false
        end
        fn = function(...)
          return attached(hook(...))
        end
      end
      if older(10) and key ~= "detach" then
        -- Each hook was a table carrying its event's number.
        local num = event_types[key]
        if num == nil then
          num = #EventType + 1
          event_types[key] = num
          EventType[#EventType + 1] = key
          EventType[key:upper()] = num
        end
        return true, setmetatable({ _type = num }, {
          __call = function(_, ...)
            return fn(...)
          end,
        })
      end
      return true, fn
    end
  end

  -----------------------------------------------------------------------------
  -- TRX 1.10: game version, end of level, cutscenes by number
  -----------------------------------------------------------------------------

  if older(11) then
    local game = hooks_for("trx.game")
    game.get.trx_version = function(value)
      return value.TRX_VERSION
    end
    game.get.end_level = function()
      return function()
        engine.game.end_level()
        local ok, text = pcall(engine.locale.get, "general/osd/complete_level")
        if ok and text ~= nil then
          engine.console.log(text)
        end
      end
    end

    local cutscenes = hooks_for("trx.cutscenes")
    cutscenes.get.current = function(value)
      local current = value.current
      return current and current.num
    end
    cutscenes.get.play = function()
      return function(num, fade)
        local cutscene = engine.cutscenes[num]
        if cutscene == nil then
          error("invalid cutscene number: " .. tostring(num), 2)
        end
        return cutscene:play({ fade = fade ~= false })
      end
    end
    cutscenes.get.is_played = function()
      return function(num)
        local cutscene = engine.cutscenes[num]
        return cutscene ~= nil and cutscene.is_played
      end
    end
    cutscenes.get.set_played = function()
      return function(num, played)
        local cutscene = engine.cutscenes[num]
        if cutscene ~= nil then
          cutscene.is_played = played
        end
      end
    end
  end

  -----------------------------------------------------------------------------
  -- TRX 1.11: items, the inventory ring, the interface
  -----------------------------------------------------------------------------

  if older(12) then
    local item = type_hooks("ITEM")
    item.get.die = function(value)
      local die = value.die
      return function(self, explode, flame_variant, sender)
        if type(explode) == "table" or explode == nil then
          return die(self, explode)
        end
        return die(self, {
          explode = explode,
          flame_variant = flame_variant,
          sender = sender,
        })
      end
    end
    item.get.shatter = function(value)
      local shatter = value.shatter
      return function(self, damage, flame_variant)
        if type(damage) == "table" or damage == nil then
          return shatter(self, damage)
        end
        return shatter(self, { damage = damage, flame_variant = flame_variant })
      end
    end

    hooks_for("trx.inventory").self_arg = true
    hooks_for("trx.stats").self_arg = true
    hooks_for("trx.inventory").get.declare_ring_item = function()
      return engine_require("common.ui.ring").declare_item
    end
    hooks_for("trx.overlay.signals").get.health_bar_forced = function()
      return engine_require("common.ui.ring").signals.health_bar
    end

    hooks_for("trx.savegame").get.load = function(value)
      return function(slot_num, pool)
        if value.is_free(slot_num, pool) then
          return false
        end
        return value.load(slot_num, pool)
      end
    end

    local ui = engine.ui
    local function negate(when)
      if type(when) == "boolean" or when == nil then
        return not when
      end
      return when:map(function(v)
        return not v
      end)
    end

    -- Widgets took `shown`, and a Label `hidden`; Resize took `h_bars`.
    local function widget(name, build_fn)
      return function(opts)
        if type(opts) == "table" then
          local copy = {}
          for k, v in pairs(opts) do
            copy[k] = v
          end
          opts = copy
          if opts.shown ~= nil and opts.visible == nil then
            opts.visible = opts.shown
          end
          opts.shown = nil
          local hidden = opts.hidden
          opts.hidden = nil
          if name == "Resize" then
            opts.h_bars = nil
          end
          local made = build_fn(opts)
          if hidden ~= nil then
            return ui.widgets.Blank({ when = hidden, child = made })
          end
          return made
        end
        return build_fn(opts)
      end
    end
    local widgets = hooks_for("trx.ui.widgets")
    widgets.index = function(value, key)
      if key == "Row" then
        return true, widget("Row", function(opts)
          local function arrow(text, lit)
            return ui.widgets.Blank({
              when = negate(lit),
              child = ui.widgets.Label({ text = text }),
            })
          end
          return ui.widgets.Stack({
            orientation = ui.Orientation.HORIZONTAL,
            spacing = opts.spacing or 15,
            visible = opts.visible,
            children = {
              arrow("\\{button left}", opts.left),
              opts.child,
              arrow("\\{button right}", opts.right),
            },
          })
        end)
      end
      local made = value[key]
      if type(made) == "function" or type(made) == "table" then
        return true, widget(key, function(opts)
          return made(opts)
        end)
      end
      return false
    end
    hooks_for("trx.ui.regions").get.fallback = function()
      return function() end
    end

    any.get.is_shown = function(value)
      local fn = value.is_visible
      return fn
    end
    any.get.wakes_on = function()
      return function(self)
        return self
      end
    end
    any.get.above = function(value)
      if value.map == nil then
        return nil
      end
      return function(self, amount)
        return self:map(function(v)
          return type(v) == "number" and v > amount
        end)
      end
    end
  end

  -----------------------------------------------------------------------------
  -- require: old module names, and set-up that runs once
  -----------------------------------------------------------------------------

  local function compat_require(name)
    if type(name) ~= "string" then
      return engine_require(name)
    end
    local lower = name:lower()
    local own = MODULE_RENAMES[lower]
    if own ~= nil then
      return wrap(guarded_require(GAME_DIR .. "." .. own))
    end
    if older(12) then
      local moved = MOVED_MODULES[lower]
      if moved ~= nil then
        local module = guarded_require(moved.name)
        if moved.setup and type(module) == "table" and module.setup then
          module.setup()
        end
        return wrap(module)
      end
    end
    if older(10) and not lower:find(".", 1, true) then
      return wrap(guarded_require(GAME_DIR .. "." .. lower))
    end
    return wrap(guarded_require(name))
  end

  return wrap(engine, "trx"), compat_require
end

local built = {}

-- Called with a release; `once` says which set-up functions have run, for
-- anyone checking from the console.
return setmetatable({ once = once_done }, {
  __call = function(_, from)
    if from == nil then
      return engine, guarded_require
    end
    local made = built[from]
    if made == nil then
      made = table.pack(build(from))
      built[from] = made
    end
    return made[1], made[2]
  end,
})
