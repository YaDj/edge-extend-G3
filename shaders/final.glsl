#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_shrinkAmount;
uniform float u_shrinkBlur;

// Функція №1: Для непрозорого фону (використовується в дебаг-режимі 1)
vec4 fixColorAndMakeOpaque(vec4 color) {
    if (color.a < 0.001) { return vec4(0.0, 0.0, 0.0, 1.0); }
    return vec4(color.rgb / color.a, 1.0);
}

// Функція №2: Для прозорих шарів (використовується для композитингу)
vec4 fixColorAndKeepAlpha(vec4 color) {
    if (color.a < 0.001) { return vec4(0.0, 0.0, 0.0, 0.0); }
    return vec4(color.rgb / color.a, color.a);
}

void main() {
  vec4 baseColor = texture(u_image, v_uv);

    // --- КЕРУВАННЯ РЕЖИМАМИ ---
    if (u_shrinkAmount < -1.5) { // Сигнал -2.0: Виправити колір, ЗБЕРІГШИ альфу
        outColor = fixColorAndKeepAlpha(baseColor);
        return;
    }
    if (u_shrinkAmount < -0.5) { // Сигнал -1.0: Виправити колір і зробити НЕПРОЗОРИМ
        outColor = fixColorAndMakeOpaque(baseColor);
    return;
  }

    // --- Логіка "SOFT EROSION" ---
	if (u_shrinkBlur <= 0.0 && u_shrinkAmount <= 0.0) {
	outColor = vec4(baseColor.rgb * baseColor.a, baseColor.a);
	return;
	}

    // КРОК 1: ЕРОЗІЯ. Знаходимо мінімальну альфу в радіусі u_shrinkAmount.
    float minAlpha = 1.0;
    int kernelRadius = int(ceil(u_shrinkAmount));
    if (kernelRadius > 0) {
  for (int y = -kernelRadius; y <= kernelRadius; ++y) {
    for (int x = -kernelRadius; x <= kernelRadius; ++x) {
                if (length(vec2(float(x), float(y))) > u_shrinkAmount) continue;
      vec2 offset = vec2(float(x), float(y)) * u_texelSize;
            minAlpha = min(minAlpha, texture(u_image, v_uv + offset).a);
    }
        }
    } else {
        minAlpha = baseColor.a;
  }

    // КРОК 2: ПОМ'ЯКШЕННЯ КРАЮ.
    // u_shrinkAmount контролює поріг, u_shrinkBlur - ширину переходу.
    float threshold = 1.0 - (u_shrinkAmount * 0.1);
    float softness = u_shrinkBlur * 0.5;
    
    float smoothedAlpha = smoothstep(threshold - softness, threshold + softness, minAlpha);
    
    // Застосовуємо фінальну альфу
  float finalAlpha = min(baseColor.a, smoothedAlpha);
    
    // Конвертуємо в premultiplied alpha для коректного блендінгу
outColor = vec4(baseColor.rgb * finalAlpha, finalAlpha);
}