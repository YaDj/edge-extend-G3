#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_shrinkAmount;
uniform float u_shrinkBlur;

// Ця функція залишається для рендеру фону
vec4 fixColorAndMakeOpaque(vec4 color) {
    if (color.a < 0.001) { return vec4(0.0, 0.0, 0.0, 1.0); }
    return vec4(color.rgb / color.a, 1.0);
}

void main() {
  vec4 baseColor = texture(u_image, v_uv);

    // Шлях для рендеру фону
  if (u_shrinkAmount < -0.5) { 
        outColor = fixColorAndMakeOpaque(baseColor);
    return;
  }

    // Шлях для простого копіювання (використовується в дебаг-режимі)
	if (u_shrinkBlur < -0.5) {
		outColor = baseColor;
		return;
	}

    // --- Логіка "SOFT EROSION" ---
    
    // Якщо ефекти вимкнені, просто конвертуємо в premultiplied alpha
	if (u_shrinkBlur <= 0.0 && u_shrinkAmount <= 0.0) {
	outColor = vec4(baseColor.rgb * baseColor.a, baseColor.a);
	return;
	}

    // КРОК 1: ЕРОЗІЯ. Знаходимо мінімальну альфу в радіусі u_shrinkAmount.
    // Це дає нам жорсткий край.
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

    // КРОК 2: ПОМ'ЯКШЕННЯ. Розмиваємо жорсткий край за допомогою u_shrinkBlur.
    // Це фінальна, правильна формула.
    float softness = 1.0 + u_shrinkBlur; // Чим більший блюр, тим більша м'якість
    float smoothedAlpha = smoothstep(1.0 - softness, 1.0, minAlpha);
    
    // Застосовуємо фінальну альфу, не виходячи за межі оригіналу
  float finalAlpha = min(baseColor.a, smoothedAlpha);
    
    // Конвертуємо в premultiplied alpha для коректного блендінгу
outColor = vec4(baseColor.rgb * finalAlpha, finalAlpha);
}