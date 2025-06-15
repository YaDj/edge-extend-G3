#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_shrinkAmount;
uniform float u_shrinkBlur;

// Функція №1: Для фону. Робить колір непрозорим.
vec4 fixColorAndMakeOpaque(vec4 color) {
    if (color.a < 0.001) { return vec4(0.0, 0.0, 0.0, 1.0); } // Непрозорий чорний
    return vec4(color.rgb / color.a, 1.0); // Непрозорий колір
}

// Функція №2: Для верхніх шарів. Зберігає прозорість.
vec4 fixColorAndKeepAlpha(vec4 color) {
    if (color.a < 0.001) { return vec4(0.0, 0.0, 0.0, 0.0); } // Прозорий чорний
    return vec4(color.rgb / color.a, color.a); // Колір + оригінальна альфа
}

void main() {
  vec4 baseColor = texture(u_image, v_uv);

    // --- КЕРУВАННЯ РЕЖИМАМИ ---
    // Сигнал -1.0: Виправити колір і зробити непрозорим (для фону)
  if (u_shrinkAmount < -0.5) { 
        outColor = fixColorAndMakeOpaque(baseColor);
        return;
    }
    // Сигнал -2.0: Виправити колір, але зберегти альфу (для аури)
    if (u_shrinkAmount < -1.5) {
        outColor = fixColorAndKeepAlpha(baseColor);
    return;
  }
	if (u_shrinkBlur < -0.5) {
		outColor = baseColor;
		return;
	}

	if (u_shrinkBlur <= 0.0 && u_shrinkAmount <= 0.0) {
	outColor = vec4(baseColor.rgb * baseColor.a, baseColor.a);
	return;
	}

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

    float softness_power = 1.0 + u_shrinkBlur;
	float smoothedAlpha = pow(minAlpha, softness_power);
    
  float finalAlpha = min(baseColor.a, smoothedAlpha);
  
outColor = vec4(baseColor.rgb * finalAlpha, finalAlpha);
}