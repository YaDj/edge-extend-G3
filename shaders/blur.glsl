#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_image;
uniform float u_radius;
uniform vec2 u_texelSize;
uniform vec2 u_direction;

void main() {
  if (u_radius <= 0.0) {
    outColor = texture(u_image, v_uv);
    return;
  }

  // Просто розмиваємо всі 4 канали (RGBA)
  vec4 sum = vec4(0.0);
  float totalWeight = 0.0;
  float sigma = u_radius / 2.0;
  float twoSigmaSq = 2.0 * sigma * sigma;
  
  int kernelRadius = int(ceil(u_radius * 2.0));

  for (int i = -kernelRadius; i <= kernelRadius; i++) {
    float dist = float(i);
    float weight = exp(-(dist * dist) / twoSigmaSq);
    vec2 offset = u_direction * u_texelSize * dist;
    
    sum += texture(u_image, v_uv + offset) * weight;
    totalWeight += weight;
  }
  
  // Нормалізуємо, щоб зберегти загальну енергію
  outColor = sum / totalWeight;
}