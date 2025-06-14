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
        return vec4(0.0, 0.0, 0.0, 1.0); // Повністю непрозорий чорний
  }
    // Повертаємо колір з відновленою яскравістю і робимо його повністю непрозорим
    return vec4(color.rgb / color.a, 1.0);
}

void main() {
  vec4 baseColor = texture(u_image, v_uv);

    // --- Шлях 1: Рендер РОЗМИТОГО ФОНУ ---
    // Якщо shrinkAmount == -1.0, це спеціальний сигнал від main.js, що потрібно виправити колір.
  if (u_shrinkAmount < -0.5) { 
        outColor = fixPremultipliedColor(baseColor);
    return;
  }

    // --- Шлях 2: Рендер ВЕРХНЬОГО ШАРУ з ефектами Shrink ---
	if (u_shrinkBlur <= 0.0 && u_shrinkAmount <= 0.0) {
	outColor = vec4(baseColor.rgb * baseColor.a, baseColor.a);
	return;
	}

  float sumAlpha = 0.0;
  float count = 0.0;
  int kernelRadius = int(ceil(u_shrinkBlur));
  for (int y = -kernelRadius; y <= kernelRadius; ++y) {
    for (int x = -kernelRadius; x <= kernelRadius; ++x) {
      if (length(vec2(float(x), float(y))) > u_shrinkBlur) continue;
      vec2 offset = vec2(float(x), float(y)) * u_texelSize;
      sumAlpha += texture(u_image, v_uv + offset).a;
      count += 1.0;
    }
  }

  float avgAlpha = (count > 0.0) ? sumAlpha / count : baseColor.a;
  float shrinkOffset = u_shrinkAmount * 0.05;
  float biasedAlpha = avgAlpha - shrinkOffset;
  float smoothedAlpha = smoothstep(0.4, 0.6, biasedAlpha); 
  float finalAlpha = min(baseColor.a, smoothedAlpha);
  
// НОВИЙ РЯДОК: Множимо колір на альфу прямо в шейдері
outColor = vec4(baseColor.rgb * finalAlpha, finalAlpha);
}