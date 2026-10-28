/*:
 * @target MZ
 * @plugindesc RPG Viewer 게임 전용 확장: CharacterPictureManager
 * @author RPG Viewer
 * @base RPGViewerBridge
 * @orderAfter RPGViewerBridge
 * @help
 * RPG Viewer가 설치하는 게임 전용 확장입니다(RPGViewerBridge 1.13.0 이상 필요).
 * CharacterPictureManager가 그리는 캐릭터 스탠딩에 배우 번호·이름·겹 이름을 붙이고,
 * 나타나기·사라지기·흐려짐(unfocus)·흔들림 같은 움직임 대신 자리 잡은 모습으로 기록합니다.
 * 스탠딩이 바뀌면 바로 화면을 다시 읽게 합니다. 메뉴 화면의 스탠딩도 기록합니다.
 * 게임 화면과 진행에는 영향을 주지 않습니다. 플러그인 명령이나 파라미터는 없습니다.
 */
(function () {
  "use strict";
  var G = Function("return this")();
  var VERSION = "1.0.0";

  // CharacterPictureManager (Triacontane) keeps its classes private. Duck typing instead:
  //   scene._standSpriteContainer (Sprite) holds one Sprite_StandPicture per actor, scene._standSprites: Map actorId -> it.
  //   Sprite_StandPicture: _pictures (StandPictureParam: _actor, getBasePoint(), _standPictures), getShakeX/Y().
  //   Sprite_StandPictureChild (one per layer): _picture (layer param: ActorId, Name, Opacity, FileName, FadeFrame...),
  //   _fileName, _openness (0..1 fade), isShowing(), isOutOfShake(), isUnFocus(); opacity = Opacity * _openness.
  function isStandParent(p) {
    return !!(p && p._pictures && typeof p._pictures === "object" && typeof p._pictures.getBasePoint === "function");
  }
  function isStandChild(s) {
    return !!(s && s._picture && typeof s._picture === "object" && typeof s.isOutOfShake === "function" && isStandParent(s.parent));
  }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function actorOf(s) {
    var id = num(s._picture.ActorId, 0);
    var a = s.parent._pictures._actor;
    if (!id && a && typeof a.actorId === "function") id = a.actorId();
    return { id: id, actor: a };
  }
  function actorName(id, a) {
    try {
      if (a && typeof a.name === "function") return String(a.name());
      var ga = G.$gameActors && G.$gameActors.actor(id);
      if (ga && typeof ga.name === "function") return String(ga.name());
    } catch (e) { /* no name */ }
    return "";
  }
  function showing(s) {
    try { return typeof s.isShowing === "function" ? s.isShowing() === true : true; } catch (e) { return true; }
  }
  function unfocused(s) {
    try { return typeof s.isUnFocus === "function" && s.isUnFocus() === true; } catch (e) { return false; }
  }

  // Signature of what the stands show: per actor, each layer's file and whether it is shown (focus is ignored).
  function standSignature(scene) {
    var map = scene && scene._standSprites;
    if (!map || typeof map.forEach !== "function") return "";
    var parts = [];
    map.forEach(function (sprite, id) {
      var ch = sprite && sprite.children;
      if (!ch) return;
      var row = [id];
      for (var i = 0; i < ch.length; i++) {
        var c = ch[i];
        if (!c || !c._picture) continue;
        row.push((c._picture.FileName || "") + (showing(c) ? "+" : "-"));
      }
      parts.push(row.join(","));
    });
    return parts.join("|");
  }

  var ext = {
    id: "character-picture-manager",
    version: VERSION,
    onInstall: function (api) {
      var SB = G.Scene_Base && G.Scene_Base.prototype;
      if (!SB) return;
      // CharacterPictureManager.updateAllStandPicture runs every scene update; the layers update their files right after
      api.hook(SB, "Scene_Base", "update", function (orig) {
        return function () {
          var r = orig.apply(this, arguments);
          try {
            if (this._standSpriteContainer && api.capturing()) {
              var sig = standSignature(this);
              if (sig !== this._rpgvStandSig) {
                this._rpgvStandSig = sig;
                api.markScreenDirty();
              }
            }
          } catch (e) { api.reportError(e); }
          return r;
        };
      });
    },
    captureScene: function (scene) {
      var m = scene && scene._standSprites;
      return !!(scene && scene._standSpriteContainer && m && m.size > 0);
    },
    // settled look: no fade (full layer opacity while shown, dropped while fading out), no shake offset, no unfocus tone
    snapshotEntry: function (sprite, entry) {
      if (!isStandChild(sprite)) return undefined;
      if (!showing(sprite)) return null;
      var e = entry.slice();
      var own = num(sprite.alpha, 0);
      var target = num(sprite._picture.Opacity, 255);
      if (own > 0 && e[7] > 0) e[7] = Math.round((e[7] / (own * 255)) * target * 100) / 100;
      var parent = sprite.parent;
      if (!sprite.isOutOfShake()) {
        var sx = typeof parent.getShakeX === "function" ? num(parent.getShakeX(), 0) : 0;
        var sy = typeof parent.getShakeY === "function" ? num(parent.getShakeY(), 0) : 0;
        e[3] = Math.round((e[3] - sx) * 100) / 100;
        e[4] = Math.round((e[4] - sy) * 100) / 100;
      }
      if (e.length > 9 && unfocused(sprite)) e[9] = 0;
      return e;
    },
    snapshotMeta: function (sprite) {
      if (!isStandChild(sprite)) return null;
      var who = actorOf(sprite);
      var meta = { adapter: "character-picture-manager", role: "stand", actorId: who.id, actorName: actorName(who.id, who.actor) };
      if (typeof sprite._picture.Name === "string" && sprite._picture.Name !== "") meta.layer = sprite._picture.Name;
      return meta;
    }
  };

  try {
    var B = G.RPGViewerBridge;
    if (B && typeof B.registerExtension === "function") B.registerExtension(ext);
    else (G.RPGViewerBridgeExtensions = G.RPGViewerBridgeExtensions || []).push(ext);
  } catch (e) { /* never break the game */ }
})();
