/*:
 * @plugindesc Fear & Hunger 1 - Forsaken Companions: leave a companion on the current tile and recruit later.
 * @author ChatGPT - community mod (experimental)
 * @help Install with MattieFM's mod loader in www/mods. Make a separate backup save. UI: English/Russian, detected from game language.
 * Set window.FHPartyCamp.language to en, ru or auto to override detection.
 */
/* global Scene_Menu, Window_MenuCommand, SceneManager, Scene_Map, Scene_MenuBase, Window_Command, Window_Help, Graphics, Game_Map, Game_Event, $dataMap, $gameMap, $gamePlayer, $gameParty, $gameSystem, $gameActors, JsonEx, Game_Item */
(function () {
    'use strict';
    var API = window.FHPartyCamp = window.FHPartyCamp || {};
    API.version = '1.0';

    // auto follows the game, never the operating system. Set to en or ru to override.
    API.language = 'auto';
    var TRANSLATIONS = {
    "en": {
        "text0": "Only available on the map.",
        "text1": "You cannot leave the main character behind.",
        "text2": "This companion is not in the party.",
        "text3": "You cannot leave the last party member behind.",
        "text4": "Companion sprite not found. Action cancelled.",
        "text5": " is waiting here.",
        "text6": "Could not leave companion: ",
        "text7": "Party data is unavailable.",
        "text8": "This companion is no longer waiting.",
        "text9": "The party is full.",
        "text10": "Character not found.",
        "text11": "Another mod prevented recruitment.",
        "text12": " has rejoined the party.",
        "text13": "Back",
        "text14": "Yes, leave here",
        "text15": "No, cancel",
        "text16": "Who should wait here?\nEquipment and skills will be preserved.\nHunger and mind will also be preserved.",
        "text17": "Are you sure? This companion will leave the party\nand wait for you here.",
        "text18": "Recruit companion",
        "text19": "Leave waiting",
        "text20": " is waiting here.\nWhat would you like to do?",
        "text21": "This companion could not be found.",
        "text22": "Leave companion"
    },
    "ru": {
        "text0": "Недоступно вне карты.",
        "text1": "Главного героя оставить нельзя.",
        "text2": "Спутник сейчас не в отряде.",
        "text3": "Нельзя оставить последнего персонажа.",
        "text4": "Не найден спрайт спутника. Отмена ради безопасности.",
        "text5": " ждёт вас здесь.",
        "text6": "Ошибка размещения: ",
        "text7": "Нет данных отряда.",
        "text8": "Спутник уже ушёл.",
        "text9": "В отряде нет свободного места.",
        "text10": "Не найден персонаж.",
        "text11": "Набор заблокирован другим модом.",
        "text12": " вернулся в отряд.",
        "text13": "Назад",
        "text14": "Да, оставить здесь",
        "text15": "Нет, отменить",
        "text16": "Кого оставить отдыхать?\nСнаряжение, навыки, голод и рассудок сохранятся.",
        "text17": "Вы уверены? Этот напарник покинет отряд\nи будет вас ждать здесь.",
        "text18": "Вернуть в отряд",
        "text19": "Пусть подождёт",
        "text20": " ждёт на этом месте.\nЧто сделать?",
        "text21": "Спутник больше не найден.",
        "text22": "Оставить спутника"
    }
};
    function language() {
        if (API.language === 'en' || API.language === 'ru') return API.language;
        var system = typeof $dataSystem !== 'undefined' ? $dataSystem : null;
        if (!system) return 'en';
        // Check visible base-game labels first: some translation patches keep the old locale.
        var commands = system.terms && system.terms.commands || [];
        var labels = [commands[0], commands[2], commands[18], commands[19]].join(' ');
        if (/[А-Яа-яЁё]/.test(labels)) return 'ru';
        if (/fight|attack|new game|continue/i.test(labels)) return 'en';
        return /^ru(?:[-_]|$)/i.test(system.locale || '') ? 'ru' : 'en';
    }
    function text(key) { return TRANSLATIONS[language()][key] || TRANSLATIONS.en[key]; }

    var SYMBOL = 'fhPartyCamp';
    var EVENT_NOTE = '<FHPartyCamp>';
    var MAX_PARTY = 4;
    var MENU_ICON = 188;

    function log(message) { if (window.console) console.log('[Forsaken Companions] ' + message); }
    function data() {
        if (!$gameSystem) return null;
        if (!$gameSystem._fhPartyCampData) {
            $gameSystem._fhPartyCampData = { nextId: 1, records: [] };
        }
        return $gameSystem._fhPartyCampData;
    }
    function records() { var d = data(); return d ? d.records : []; }
    function actorWithId(actorId) { return $gameActors && $gameActors.actor(Number(actorId)); }
    function isWaiting(actorId) {
        return records().some(function (r) { return r.actorId === Number(actorId); });
    }
    function captureActor(actor) {
        return {
            hp: actor._hp, mp: actor._mp, tp: actor._tp,
            exp: JSON.parse(JSON.stringify(actor._exp || {})),
            skills: (actor._skills || []).slice(),
            equips: (actor._equips || []).map(function (i) {
                return i ? { dataClass: i._dataClass || '', itemId: Number(i._itemId || 0) } : null;
            }),
            states: (actor._states || []).slice(),
            stateTurns: JSON.parse(JSON.stringify(actor._stateTurns || {})),
            buffs: (actor._buffs || []).slice(),
            buffTurns: (actor._buffTurns || []).slice()
        };
    }
    function restoreActor(actor, s) {
        if (!actor || !s) return;
        actor._hp = s.hp;
        actor._mp = s.mp;
        actor._tp = s.tp;
        actor._exp = JSON.parse(JSON.stringify(s.exp || {}));
        actor._skills = (s.skills || []).slice();
        actor._states = (s.states || []).slice();
        actor._stateTurns = JSON.parse(JSON.stringify(s.stateTurns || {}));
        actor._buffs = (s.buffs || []).slice();
        actor._buffTurns = (s.buffTurns || []).slice();
        if (s.equips && typeof Game_Item !== 'undefined') {
            actor._equips = s.equips.map(function (e) {
                var gi = new Game_Item();
                if (e) { gi._dataClass = e.dataClass; gi._itemId = e.itemId; }
                return gi;
            });
        }
        actor.refresh();
    }

    function nearbySprite(actor) {
        var name = actor.characterName ? actor.characterName() : '';
        var index = actor.characterIndex ? actor.characterIndex() : 0;
        var members = $gameParty.members();
        var position = members.indexOf(actor);
        if (!name && position > 0 && $gamePlayer.followers) {
            var f = $gamePlayer.followers().follower(position - 1);
            if (f) { name = f.characterName(); index = f.characterIndex(); }
        }
        return { name: name || '', index: index || 0 };
    }
    function placeForRecord(r) {
        return {
            id: 0,
            name: 'FH Camp: ' + r.actorId,
            note: EVENT_NOTE,
            meta: { FHPartyCamp: true },
            x: r.x,
            y: r.y,
            pages: [{
                conditions: { actorId: 1, actorValid: false, itemId: 1, itemValid: false,
                    selfSwitchCh: 'A', selfSwitchValid: false, switch1Id: 1, switch1Valid: false,
                    switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0 },
                image: { tileId: 0, characterName: r.characterName || '', characterIndex: r.characterIndex || 0,
                    direction: r.direction || 2, pattern: 1 },
                moveType: 0, moveSpeed: 3, moveFrequency: 3,
                moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
                walkAnime: true, stepAnime: false, directionFix: true,
                through: false, priorityType: 1, trigger: 0,
                list: [{ code: 0, indent: 0, parameters: [] }]
            }]
        };
    }
    function validContext() {
        return $gameMap && $gamePlayer && $dataMap && $dataMap.events &&
            $gameMap.mapId() > 0 && !$gameParty.inBattle();
    }
    function clearCampEvents() {
        if (!validContext()) return;
        var evs = $gameMap._events || [];
        for (var i = 0; i < evs.length; i++) {
            if (evs[i] && evs[i]._fhPartyCampKey != null) {
                if ($dataMap.events[i] && $dataMap.events[i].note === EVENT_NOTE) $dataMap.events[i] = null;
                evs[i] = null;
            }
        }
        for (var j = 0; j < $dataMap.events.length; j++) {
            if ($dataMap.events[j] && $dataMap.events[j].note === EVENT_NOTE) $dataMap.events[j] = null;
        }
    }
    function spawnRecord(r) {
        var id = 1;
        while ($dataMap.events[id] || $gameMap._events[id]) id++;
        var eventData = placeForRecord(r);
        eventData.id = id;
        $dataMap.events[id] = eventData;
        var npc = new Game_Event($gameMap.mapId(), id);
        npc._fhPartyCampKey = r.key;
        $gameMap._events[id] = npc;
        return npc;
    }
    function rebuild() {
        if (!validContext()) return;
        clearCampEvents();
        var mapId = $gameMap.mapId();
        records().forEach(function (r) {
            if (r.mapId === mapId && $gameParty._actors.indexOf(r.actorId) < 0) {
                spawnRecord(r);
            }
        });
        $gameMap.requestRefresh();
    }

    API.drop = function (actorId) {
        actorId = Number(actorId);
        if (!validContext()) return { ok: false, message: text('text0') };
        var leader = $gameParty.leader();
        var actor = actorWithId(actorId);
        if (!actor || !leader || actorId === leader.actorId()) return { ok: false, message: text('text1') };
        if ($gameParty.members().indexOf(actor) < 0 || isWaiting(actorId)) return { ok: false, message: text('text2') };
        if ($gameParty.members().length < 2) return { ok: false, message: text('text3') };
        var d = data();
        var sprite = nearbySprite(actor);
        if (!sprite.name) return { ok: false, message: text('text4') };
        var record = {
            key: d.nextId++, actorId: Number(actorId), mapId: $gameMap.mapId(),
            x: $gamePlayer.x, y: $gamePlayer.y, direction: $gamePlayer.direction(),
            characterName: sprite.name, characterIndex: sprite.index,
            snapshot: captureActor(actor)
        };
        d.records.push(record);
        try {
            $gameParty.removeActor(actorId);
            rebuild();
            return { ok: true, message: actor.name() + text('text5') };
        } catch (err) {
            d.records = d.records.filter(function (r) { return r.key !== record.key; });
            if ($gameParty.members().indexOf(actor) < 0) $gameParty.addActor(actorId);
            return { ok: false, message: text('text6') + err.message };
        }
    };

    API.recruit = function (key) {
        var d = data();
        if (!d) return { ok: false, message: text('text7') };
        var r = d.records.filter(function (v) { return v.key === key; })[0];
        if (!r) return { ok: false, message: text('text8') };
        if ($gameParty.members().length >= MAX_PARTY) return { ok: false, message: text('text9') };
        var actor = actorWithId(r.actorId);
        if (!actor) return { ok: false, message: text('text10') };
        d.records = d.records.filter(function (v) { return v.key !== key; });
        try {
            restoreActor(actor, r.snapshot);
            $gameParty.addActor(r.actorId);
            if ($gameParty.members().indexOf(actor) < 0) throw Error(text('text11'));
            rebuild();
            return { ok: true, message: actor.name() + text('text12') };
        } catch (err) {
            if ($gameParty.members().indexOf(actor) < 0) d.records.push(r);
            return { ok: false, message: err.message };
        }
    };
    API.getRecord = function (key) { return records().filter(function (v) { return v.key === key; })[0]; };

    var originalSetupEvents = Game_Map.prototype.setupEvents;
    Game_Map.prototype.setupEvents = function () {
        originalSetupEvents.call(this);
        rebuild();
    };
    var originalCreateMapDisplay = Scene_Map.prototype.createDisplayObjects;
    Scene_Map.prototype.createDisplayObjects = function () {
        rebuild();
        originalCreateMapDisplay.call(this);
    };

    function Window_FHCampActors() { this.initialize.apply(this, arguments); }
    Window_FHCampActors.prototype = Object.create(Window_Command.prototype);
    Window_FHCampActors.prototype.constructor = Window_FHCampActors;
    Window_FHCampActors.prototype.initialize = function () {
        Window_Command.prototype.initialize.call(this, 0, 0);
        this.x = Math.floor((Graphics.boxWidth - this.width) / 2);
        this.y = Math.floor((Graphics.boxHeight - this.height) / 2) + 35;
    };
    Window_FHCampActors.prototype.windowWidth = function () { return Math.min(440, Graphics.boxWidth - 30); };
    Window_FHCampActors.prototype.numVisibleRows = function () { return 4; };
    Window_FHCampActors.prototype.makeCommandList = function () {
        var all = $gameParty.members(), leader = $gameParty.leader();
        all.forEach(function (actor) {
            if (actor && actor !== leader && !isWaiting(actor.actorId())) this.addCommand(actor.name(), 'actor', true, actor.actorId());
        }, this);
        this.addCommand(text('text13'), 'cancel');
    };

    function Window_FHCampConfirm() { this.initialize.apply(this, arguments); }
    Window_FHCampConfirm.prototype = Object.create(Window_Command.prototype);
    Window_FHCampConfirm.prototype.constructor = Window_FHCampConfirm;
    Window_FHCampConfirm.prototype.initialize = function () {
        Window_Command.prototype.initialize.call(this, 0, 0);
        this.x = Math.floor((Graphics.boxWidth - this.width) / 2);
        this.y = Math.floor((Graphics.boxHeight - this.height) / 2) + 65;
        this.hide();
        this.deactivate();
    };
    Window_FHCampConfirm.prototype.windowWidth = function () { return Math.min(440, Graphics.boxWidth - 30); };
    Window_FHCampConfirm.prototype.numVisibleRows = function () { return 2; };
    Window_FHCampConfirm.prototype.makeCommandList = function () {
        this.addCommand(text('text14'), 'yes');
        this.addCommand(text('text15'), 'no');
    };

    function Scene_FHPartyCamp() { this.initialize.apply(this, arguments); }
    Scene_FHPartyCamp.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_FHPartyCamp.prototype.constructor = Scene_FHPartyCamp;
    Scene_FHPartyCamp.prototype.create = function () {
        Scene_MenuBase.prototype.create.call(this);
        this._campHelp = new Window_Help(3);
        this._campHelp.y = Math.floor(Graphics.boxHeight * 0.1);
        this._campHelp.setText(text('text16'));
        this.addWindow(this._campHelp);
        this._campActors = new Window_FHCampActors();
        this._campActors.setHandler('actor', this.chooseActor.bind(this));
        this._campActors.setHandler('cancel', this.popScene.bind(this));
        this.addWindow(this._campActors);
        this._campActors.activate();
        this._campActors.select(0);
        this._campConfirm = new Window_FHCampConfirm();
        this._campConfirm.setHandler('yes', this.yesLeave.bind(this));
        this._campConfirm.setHandler('no', this.noLeave.bind(this));
        this._campConfirm.setHandler('cancel', this.noLeave.bind(this));
        this.addWindow(this._campConfirm);
    };
    Scene_FHPartyCamp.prototype.chooseActor = function () {
        this._actorId = this._campActors.currentExt();
        this._campActors.deactivate();
        this._campHelp.setText(text('text17'));
        this._campConfirm.show();
        this._campConfirm.activate();
        this._campConfirm.select(1);
    };
    Scene_FHPartyCamp.prototype.noLeave = function () {
        this._campConfirm.hide();
        this._campConfirm.deactivate();
        this._campActors.activate();
        this._campHelp.setText(text('text16'));
    };
    Scene_FHPartyCamp.prototype.yesLeave = function () {
        var result = API.drop(this._actorId);
        if (result.ok) {
            SceneManager.goto(Scene_Map);
        } else {
            this.noLeave();
            this._campHelp.setText(result.message);
        }
    };

    function Window_FHCampPickupCommand() { this.initialize.apply(this, arguments); }
    Window_FHCampPickupCommand.prototype = Object.create(Window_Command.prototype);
    Window_FHCampPickupCommand.prototype.constructor = Window_FHCampPickupCommand;
    Window_FHCampPickupCommand.prototype.initialize = function () {
        Window_Command.prototype.initialize.call(this, 0, 0);
        this.x = Math.floor((Graphics.boxWidth - this.width) / 2);
        this.y = Math.floor((Graphics.boxHeight - this.height) / 2) + 55;
    };
    Window_FHCampPickupCommand.prototype.windowWidth = function () { return Math.min(420, Graphics.boxWidth - 30); };
    Window_FHCampPickupCommand.prototype.numVisibleRows = function () { return 2; };
    Window_FHCampPickupCommand.prototype.makeCommandList = function () {
        this.addCommand(text('text18'), 'take');
        this.addCommand(text('text19'), 'leave');
    };

    function Scene_FHPartyCampPickup() { this.initialize.apply(this, arguments); }
    Scene_FHPartyCampPickup.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_FHPartyCampPickup.prototype.constructor = Scene_FHPartyCampPickup;
    Scene_FHPartyCampPickup.prototype.create = function () {
        Scene_MenuBase.prototype.create.call(this);
        var rec = API.getRecord(API._pendingRecruitKey);
        this._record = rec;
        this._help = new Window_Help(3);
        this._help.y = Math.floor(Graphics.boxHeight * 0.1);
        var actor = rec ? actorWithId(rec.actorId) : null;
        var prompt = actor ? (actor.name() + text('text20')) : text('text21');
        this._help.setText(prompt);
        this.addWindow(this._help);
        this._cmd = new Window_FHCampPickupCommand();
        this._cmd.setHandler('take', this.takeActor.bind(this));
        this._cmd.setHandler('leave', this.popScene.bind(this));
        this._cmd.setHandler('cancel', this.popScene.bind(this));
        this.addWindow(this._cmd);
        this._cmd.activate();
        this._cmd.select(0);
    };
    Scene_FHPartyCampPickup.prototype.takeActor = function () {
        var result = API.recruit(API._pendingRecruitKey);
        if (result.ok) {
            SceneManager.goto(Scene_Map);
        } else {
            this._help.setText(result.message);
            this._cmd.activate();
        }
    };

    var originalEventStart = Game_Event.prototype.start;
    Game_Event.prototype.start = function () {
        if (this._fhPartyCampKey == null) return originalEventStart.call(this);
        API._pendingRecruitKey = this._fhPartyCampKey;
        if (typeof this.clearStartingFlag === 'function') this.clearStartingFlag();
        this._starting = false;
        if (typeof this.unlock === 'function') this.unlock();
        SceneManager.push(Scene_FHPartyCampPickup);
    };

    var originalAddMainCommands = Window_MenuCommand.prototype.addMainCommands;
    Window_MenuCommand.prototype.addMainCommands = function () {
        originalAddMainCommands.call(this);
        this.addCommand(text('text22'), SYMBOL, $gameParty.members().length > 1);
    };
    var originalCreateMenuCommandWindow = Scene_Menu.prototype.createCommandWindow;
    Scene_Menu.prototype.createCommandWindow = function () {
        originalCreateMenuCommandWindow.call(this);
        this._commandWindow.setHandler(SYMBOL, function () {
            SceneManager.push(Scene_FHPartyCamp);
        });
    };

    function drawIconFrame(win, x, y, size) {
        var b = win.contents;
        b.fillRect(x, y, size, size, 'rgba(0,0,0,0.65)');
        b.fillRect(x + 1, y + 1, size - 2, 1, 'rgba(206,191,196,0.95)');
        b.fillRect(x + 1, y + size - 2, size - 2, 1, 'rgba(110,94,103,0.95)');
        b.fillRect(x + 1, y + 1, 1, size - 2, 'rgba(206,191,196,0.95)');
        b.fillRect(x + size - 2, y + 1, 1, size - 2, 'rgba(110,94,103,0.95)');
    }
    var originalMenuDrawItem = Window_MenuCommand.prototype.drawItem;
    Window_MenuCommand.prototype.drawItem = function (index) {
        if (this.commandSymbol(index) !== SYMBOL) return originalMenuDrawItem.call(this, index);
        var rect = this.itemRectForText(index);
        this.resetTextColor();
        this.changePaintOpacity(this.isCommandEnabled(index));
        if (rect.width <= 110) {
            var size = 36;
            var fx = rect.x + Math.floor((rect.width - size) / 2);
            var fy = rect.y + Math.floor((rect.height - size) / 2);
            drawIconFrame(this, fx, fy, size);
            this.drawIcon(MENU_ICON, fx + 2, fy + 2);
        } else {
            var s = 36;
            var iy = rect.y + Math.max(0, Math.floor((rect.height - s) / 2));
            drawIconFrame(this, rect.x, iy, s);
            this.drawIcon(MENU_ICON, rect.x + 2, iy + 2);
            this.drawText(text('text22'), rect.x + 42, rect.y, rect.width - 42);
        }
    };

    log('v' + API.version + ' loaded');
}());
