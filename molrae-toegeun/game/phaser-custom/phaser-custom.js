/**
 * Phaser 3.90 커스텀 빌드 진입점(T-155, D-102·D-073). 프로덕션 빌드에서만 `import Phaser from 'phaser'`를 이 파일로 바꾼다(vite.config.ts).
 * 개발 서버(`npm run dev`)와 타입은 원래 패키지 그대로다.
 *
 * 기준: node_modules/phaser/src/phaser-core.js(공식 '코어' 빌드)에서 이 게임이 쓰지 않는 것을 빼고, 쓰는 것을 더했다.
 *  - 뺀 것: 물리(Arcade·Matter), 타일맵, 커브·경로, 파티클·메시·비디오·셰이더·로프·나인슬라이스·컨테이너·블리터 등 게임 오브젝트,
 *           Actions·Create·Utils 네임스페이스, Tweens(트윈 미사용), Lights 플러그인, DOM 요소, 로더 파일형(XML·스크립트·플러그인·스프라이트시트·오디오 스프라이트·텍스트)
 *  - 더한 것: Rectangle·BitmapText·RenderTexture(게임이 씀), Sound(FEATURE_SOUND)
 * 내부에서 require하는 모듈(Geom·Math·Color 등)은 번들러가 의존성대로 따라 넣는다.
 * 새 Phaser 기능(this.add.xxx, this.tweens, this.load.xxx 등)을 쓰면 여기에도 추가해야 한다(없으면 프로덕션에서만 undefined).
 */
import 'phaser/src/polyfills/requestVideoFrame.js';
import CONST from 'phaser/src/const.js';
import Extend from 'phaser/src/utils/object/Extend.js';

import Animations from 'phaser/src/animations/index.js';
import BlendModes from 'phaser/src/renderer/BlendModes.js';
import Cache from 'phaser/src/cache/index.js';
import CamerasScene2D from 'phaser/src/cameras/2d/index.js';
import Core from 'phaser/src/core/index.js';
import Class from 'phaser/src/utils/Class.js';
import Data from 'phaser/src/data/index.js';
import DOM from 'phaser/src/dom/index.js';
import Events from 'phaser/src/events/index.js';
import Game from 'phaser/src/core/Game.js';

import DisplayList from 'phaser/src/gameobjects/DisplayList.js';
import GameObjectCreator from 'phaser/src/gameobjects/GameObjectCreator.js';
import GameObjectFactory from 'phaser/src/gameobjects/GameObjectFactory.js';
import UpdateList from 'phaser/src/gameobjects/UpdateList.js';
import Components from 'phaser/src/gameobjects/components/index.js';
import BuildGameObject from 'phaser/src/gameobjects/BuildGameObject.js';
import BuildGameObjectAnimation from 'phaser/src/gameobjects/BuildGameObjectAnimation.js';
import GameObject from 'phaser/src/gameobjects/GameObject.js';
import Graphics from 'phaser/src/gameobjects/graphics/Graphics.js';
import Image from 'phaser/src/gameobjects/image/Image.js';
import Sprite from 'phaser/src/gameobjects/sprite/Sprite.js';
import Text from 'phaser/src/gameobjects/text/Text.js';
import Rectangle from 'phaser/src/gameobjects/shape/rectangle/Rectangle.js';
import BitmapText from 'phaser/src/gameobjects/bitmaptext/static/BitmapText.js';
import RenderTexture from 'phaser/src/gameobjects/rendertexture/RenderTexture.js';
// 팩토리(this.add.xxx): require 순간 GameObjectFactory.register로 등록됨
import GraphicsFactory from 'phaser/src/gameobjects/graphics/GraphicsFactory.js';
import ImageFactory from 'phaser/src/gameobjects/image/ImageFactory.js';
import SpriteFactory from 'phaser/src/gameobjects/sprite/SpriteFactory.js';
import TextFactory from 'phaser/src/gameobjects/text/TextFactory.js';
import RectangleFactory from 'phaser/src/gameobjects/shape/rectangle/RectangleFactory.js';
import BitmapTextFactory from 'phaser/src/gameobjects/bitmaptext/static/BitmapTextFactory.js';
import RenderTextureFactory from 'phaser/src/gameobjects/rendertexture/RenderTextureFactory.js';

import Input from 'phaser/src/input/index.js';

// 로더 파일형(this.load.xxx): require 순간 FileTypesManager.register로 등록됨
import AtlasJSONFile from 'phaser/src/loader/filetypes/AtlasJSONFile.js';
import AudioFile from 'phaser/src/loader/filetypes/AudioFile.js';
import HTML5AudioFile from 'phaser/src/loader/filetypes/HTML5AudioFile.js';
import ImageFile from 'phaser/src/loader/filetypes/ImageFile.js';
import JSONFile from 'phaser/src/loader/filetypes/JSONFile.js';
import LoaderEvents from 'phaser/src/loader/events/index.js';
import File from 'phaser/src/loader/File.js';
import FileTypesManager from 'phaser/src/loader/FileTypesManager.js';
import LoaderPlugin from 'phaser/src/loader/LoaderPlugin.js';

import Between from 'phaser/src/math/Between.js';
import Clamp from 'phaser/src/math/Clamp.js';
import DegToRad from 'phaser/src/math/DegToRad.js';
import FloatBetween from 'phaser/src/math/FloatBetween.js';
import RadToDeg from 'phaser/src/math/RadToDeg.js';
import Vector2 from 'phaser/src/math/Vector2.js';

import Plugins from 'phaser/src/plugins/index.js';
import Renderer from 'phaser/src/renderer/index.js';
import Scale from 'phaser/src/scale/index.js';
import ScaleModes from 'phaser/src/renderer/ScaleModes.js';
import Scene from 'phaser/src/scene/Scene.js';
import Scenes from 'phaser/src/scene/index.js';
import Structs from 'phaser/src/structs/index.js';
import Textures from 'phaser/src/textures/index.js';
import Time from 'phaser/src/time/index.js';
import Sound from 'phaser/src/sound/index.js';

let Phaser = {
  Animations, BlendModes, Cache, Cameras: { Scene2D: CamerasScene2D }, Core, Class, Data, DOM, Events, Game,
  GameObjects: {
    DisplayList, GameObjectCreator, GameObjectFactory, UpdateList, Components, BuildGameObject, BuildGameObjectAnimation, GameObject,
    Graphics, Image, Sprite, Text, Rectangle, BitmapText, RenderTexture,
    Factories: { Graphics: GraphicsFactory, Image: ImageFactory, Sprite: SpriteFactory, Text: TextFactory, Rectangle: RectangleFactory, BitmapText: BitmapTextFactory, RenderTexture: RenderTextureFactory },
  },
  Input,
  Loader: {
    Events: LoaderEvents,
    FileTypes: { AtlasJSONFile, AudioFile, HTML5AudioFile, ImageFile, JSONFile },
    File, FileTypesManager, LoaderPlugin,
  },
  Math: { Between, Clamp, DegToRad, FloatBetween, RadToDeg, Vector2 },
  Plugins, Renderer, Scale, ScaleModes, Scene, Scenes, Structs, Textures, Time, Sound,
};

Phaser = Extend(false, Phaser, CONST);

export default Phaser;
