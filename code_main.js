// Фінальна, правильна версія render()
function render() {
    if (!originalTexture) return;

    const radius = parseFloat(radiusSlider.value);
    const shrinkBlurValue = parseFloat(shrinkBlurSlider.value);
    radiusLabel.textContent = radius.toFixed(1);
    const [imgW, imgH] = imageSize;
    const texelSize = [1 / imgW, 1 / imgH];

    drawFullScreenQuad();
    gl.disable(gl.BLEND);

    // --- ЕТАП 1: Генеруємо всі необхідні шари ---
    // 1a: Розмитий фон -> fbo2
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo1.fbo);
    gl.viewport(0, 0, imgW, imgH);
    drawPass(programBlur, originalTexture, { radius, texelSize, direction: [1, 0] });
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo2.fbo);
    gl.viewport(0, 0, imgW, imgH);
    drawPass(programBlur, fbo1.texture, { radius, texelSize, direction: [0, 1] });

    // 1b: Верхній шар з ефектом "Soft Erosion" -> fboShrunk
    if (showOriginalOnTop) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboShrunk.fbo);
        gl.viewport(0, 0, imgW, imgH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawPass(programFinal, originalTexture, { shrinkAmount, shrinkBlur: shrinkBlurValue, texelSize });
    }

    // --- ЕТАП 2: Визначаємо, що саме малювати на екран ---
    let textureToDraw;
    let uniformsToDraw = {};
    let enableBlend = false;

    if (debugPass === 1) { // Показати фон (непрозорий)
        textureToDraw = fbo2.texture;
        uniformsToDraw = { shrinkAmount: -1.0 };
        enableBlend = false;

    } else if (debugPass === 2 && showOriginalOnTop) { // Показати верхній шар (напівпрозорий)
        textureToDraw = fboShrunk.texture;
        uniformsToDraw = {};
        enableBlend = true;

    } else { // Стандартний режим (debugPass === 0)
        if (showOriginalOnTop) {
            // Створюємо фінальну композицію в outputFBO
            gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO.fbo);
            gl.viewport(0, 0, imgW, imgH);
            gl.clearColor(0, 0, 0, 0); // Починаємо з прозорого
            gl.clear(gl.COLOR_BUFFER_BIT);
            
            // Шар 1 (фон, напівпрозорий)
            drawPass(programFinal, fbo2.texture, { shrinkAmount: -2.0 });
            
            // Накладаємо Шар 2 (верхній шар)
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            drawPass(programFinal, fboShrunk.texture, {});
            gl.disable(gl.BLEND);

            // Результат - це те, що в outputFBO
            textureToDraw = outputFBO.texture;
            enableBlend = true; // Результат напівпрозорий, тому змішуємо з фоном екрану
            uniformsToDraw = {};

        } else {
            // Якщо галочка вимкнена, просто показуємо непрозорий фон
            textureToDraw = fbo2.texture;
            uniformsToDraw = { shrinkAmount: -1.0 };
            enableBlend = false;
        }
    }
    
    // --- ЕТАП 3: Малюємо фінальний результат на екран ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.2, 0.2, 0.2, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    const vpX = Math.round((gl.canvas.width / 2) - (imgW * scale / 2) + panX);
    const vpY = Math.round((gl.canvas.height / 2) - (imgH * scale / 2) - panY);
    gl.viewport(vpX, vpY, Math.round(imgW * scale), Math.round(imgH * scale));
    
    if (textureToDraw) {
        if (enableBlend) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        } else {
            gl.disable(gl.BLEND);
        }
        drawPass(programFinal, textureToDraw, uniformsToDraw);
        if (enableBlend) gl.disable(gl.BLEND);
    }
}