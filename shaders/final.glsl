#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

// Додаємо другий семплер для операцій з двома текстурами
uniform sampler2D u_image;
uniform sampler2D u_image2; 

uniform vec2 u_texelSize;
uniform float u_shrinkAmount;
uniform float u_shrinkBlur;
uniform float u_threshold;

// --- НАБІР НАШИХ ФУНКЦІЙ ---

// Функція для непрозорого фону (стара)
vec4 op_makeOpaqueBackground(vec4 color) {
    if (color.a < 0.001) { return vec4(0.0, 0.0, 0.0, 1.0); }
    return vec4(color.rgb / color.a, 1.0);
}

// Функція для "Edge Extend" (ChannelBooleans Divide)
vec4 op_edgeExtend(vec4 color) {
    if (color.a < 0.001) { return vec4(0.0); }
    return vec4(color.rgb / color.a, color.a);
}

void main() {
    // --- КЕРУВАННЯ РЕЖИМАМИ ---
    // u_shrinkAmount використовується як головний перемикач режиму
    
    // Режим -1.0: Створити непрозорий фон
    if (u_shrinkAmount < -0.5 && u_shrinkAmount > -1.5) { 
        outColor = op_makeOpaqueBackground(texture(u_image, v_uv));
    return;
  }

    // Режим -2.0: Зробити "Edge Extend"
    if (u_shrinkAmount < -1.5 && u_shrinkAmount > -2.5) {
        outColor = op_edgeExtend(texture(u_image, v_uv));
		return;
	}

	// Режим -3.0: Створити "Hard Matte"
	if (u_shrinkAmount < -2.5 && u_shrinkAmount > -3.5) {
		float blurredAlpha = texture(u_image, v_uv).a;
		// Використовуємо u_threshold для контролю
		float hardAlpha = smoothstep(u_threshold, u_threshold + 0.01, blurredAlpha);
		outColor = vec4(vec3(hardAlpha), 1.0);
		return;
	}

    // Режим -4.0: Скомбінувати колір з інвертованою маскою
    if (u_shrinkAmount < -3.5 && u_shrinkAmount > -4.5) {
        vec3 color = texture(u_image, v_uv).rgb;
        float matteAlpha = texture(u_image2, v_uv).r; // Читаємо маску з червоного каналу
        outColor = vec4(color, 1.0 - matteAlpha);
        return;
    }
    
    // --- Стандартна логіка для простого "Soft Erosion" (залишаємо для дебагу) ---
    vec4 baseColor = texture(u_image, v_uv);
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

    // КРОК 2: ПОМ'ЯКШЕННЯ
    float softness = u_shrinkBlur * 0.1; 
    float threshold = 0.5;
    float smoothedAlpha = smoothstep(threshold - softness, threshold + softness, minAlpha);
    
    // Застосовуємо фінальну альфу, не виходячи за межі оригіналу
  float finalAlpha = min(baseColor.a, smoothedAlpha);
    
    // Конвертуємо в premultiplied alpha для коректного блендінгу
outColor = vec4(baseColor.rgb * finalAlpha, finalAlpha);
}