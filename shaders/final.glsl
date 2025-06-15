#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_shrinkAmount;
uniform float u_shrinkBlur;

// Функція для відновлення яскравості (un-premultiply) і встановлення непрозорості
vec4 fixPremultipliedColor(vec4 color) {
  if (color.a < 0.001) {
        return vec4(0.0, 0.0, 0.0, 1.0);
  }
    return vec4(color.rgb / color.a, 1.0);
}

void main() {
  vec4 baseColor = texture(u_image, v_uv);

    // --- Шлях 1: Рендер РОЗМИТОГО ФОНУ ---
  if (u_shrinkAmount < -0.5) { 
        outColor = fixPremultipliedColor(baseColor);
    return;
  }

    // --- Шлях 2: Рендер ВЕРХНЬОГО ШАРУ з ефектом EROSION ---
    
    // Якщо ефекти вимкнені, просто конвертуємо в premultiplied alpha для блендінгу
	if (u_shrinkBlur <= 0.0 && u_shrinkAmount <= 0.0) {
	outColor = vec4(baseColor.rgb * baseColor.a, baseColor.a);
	return;
	}

    // КРОК 1: ЕРОЗІЯ. Знаходимо мінімальну альфу в радіусі u_shrinkAmount.
    float minAlpha = 1.0;
    int kernelRadius = int(ceil(u_shrinkAmount));

  for (int y = -kernelRadius; y <= kernelRadius; ++y) {
    for (int x = -kernelRadius; x <= kernelRadius; ++x) {
            // Перевіряємо, чи піксель знаходиться всередині кругового ядра
            if (length(vec2(float(x), float(y))) > u_shrinkAmount) {
                continue;
            }
      vec2 offset = vec2(float(x), float(y)) * u_texelSize;
            minAlpha = min(minAlpha, texture(u_image, v_uv + offset).a);
    }
  }

    // КРОК 2: КОНТРОЛЬ ЖОРСТКОСТІ КРАЮ.
	float softness_power = 1.0 + u_shrinkBlur * 3.0;
	float smoothedAlpha = pow(minAlpha, softness_power);
    
    // Завжди беремо мінімум між оригінальною альфою і результатом ерозії,
    // щоб ефект не "виходив" за межі оригінального зображення.
  float finalAlpha = min(baseColor.a, smoothedAlpha);
  
    // Конвертуємо в premultiplied alpha для коректного блендінгу
outColor = vec4(baseColor.rgb * finalAlpha, finalAlpha);
}