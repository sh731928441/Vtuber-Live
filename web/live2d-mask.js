/* Live2D 裁剪蒙版修复（cubism4.min.js / pixi-live2d-display 的补丁层）
 *
 * 症状：嘴、鼻子、眼睛这些靠裁剪蒙版切出来的脸部部件被别的部件裁掉，脸上出现一块
 * 颜色不对的硬边区域（“红红的 bug”），而模型在 VTube Studio 里是正常的。
 *
 * 原因：Cubism 4 每帧把用到的裁剪蒙版排进若干张 256×256 的离屏贴图，一张贴图 4 个
 * 通道、每个通道最多 9 个蒙版，也就是单张贴图最多 36 个。超过 36 个时 SDK 不报错，
 * 而是走降级路径：把所有蒙版塞进同一张贴图的同一个通道，整帧只清一次屏。于是所有
 * 部件的蒙版叠成一张“并集”，谁的蒙版盖住哪里，哪里就被裁掉——头发、身体、衣服的
 * 蒙版直接把脸切了。大肥鱼这类 VTube Studio 皮套（独立蒙版 40+ 个）最容易踩到。
 *
 * 修法：切到 SDK 自带的高精度蒙版模式。该模式下每个 drawable 绘制前都会单独清屏、
 * 只重画自己的那几张蒙版，蒙版之间不再互相污染。代价是每帧多若干次 256×256 的离屏
 * 绘制，帧率会掉一点。
 */
(function (global) {
  'use strict';

  // 与 SDK 的 setupLayoutBounds 保持一致：单张贴图 9×4=36，多张贴图时每张 8×4=32。
  function maskLimit(clippingManager) {
    var n = typeof clippingManager.getRenderTextureCount === 'function'
      ? clippingManager.getRenderTextureCount() : 1;
    return n <= 1 ? 36 : 32 * n;
  }

  function stats(model) {
    var im = model && model.internalModel;
    var renderer = im && im.renderer;
    var cm = renderer && renderer._clippingManager;
    if (!cm || !cm._clippingContextListForMask) return null;   // 模型没有蒙版
    return {
      renderer: renderer,
      contexts: cm._clippingContextListForMask.length,
      limit: maskLimit(cm),
      textures: typeof cm.getRenderTextureCount === 'function' ? cm.getRenderTextureCount() : 1,
      highPrecision: typeof renderer.isUsingHighPrecisionMask === 'function'
        && renderer.isUsingHighPrecisionMask()
    };
  }

  // 只在该模型真的超限时才动手；返回 null 表示“没蒙版 / 没超限 / 已经开过”。
  // force=true 时无条件开启，方便排查。
  function apply(model, force) {
    var s = stats(model);
    if (!s) return null;
    if (!force && s.contexts <= s.limit) return null;
    if (s.highPrecision) return null;
    if (typeof s.renderer.useHighPrecisionMask !== 'function') return null;

    s.renderer.useHighPrecisionMask(true);
    var info = {
      contexts: s.contexts,
      limit: s.limit,
      textures: s.textures,
      highPrecision: true
    };
    console.info('[live2d] 裁剪蒙版 ' + s.contexts + ' 个，超过单张蒙版贴图上限 ' + s.limit +
      ' 个，已改用高精度蒙版逐 drawable 重画（脸部不再被别的部件裁掉）');
    return info;
  }

  global.Live2DMaskFix = { apply: apply, stats: stats };
})(window);
