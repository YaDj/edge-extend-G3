#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_image;
uniform float u_radius;
uniform vec2 u_texelSize;
uniform vec2 u_direction;

void main() {
    vec4 baseColor = texture(u_image, v_uv);

    if (u_radius <= 0.0) {
        outColor = baseColor;
        return;
    }

    // Розмиваємо ТІЛЬКИ альфа-канал
    float sum = 0.0;
    float totalWeight = 0.0;
    float sigma = u_radius / 2.0;
    float twoSigmaSq = 2.0 * sigma * sigma;
    int kernelRadius = int(ceil(u_radius * 2.0));

    for (int i = -kernelRadius; i <= kernelRadius; i++) {
        float dist = float(i);
        float weight = exp(-(dist * dist) / twoSigmaSq);
        vec2 offset = u_direction * u_texelSize * dist;
        
        sum += texture(u_image, v_uv + offset).a * weight;
        totalWeight += weight;
    }
    
    float blurredAlpha = sum / totalWeight;

    // Повертаємо оригінальний колір, але з новою, розмитою альфою
    outColor = vec4(baseColor.rgb, blurredAlpha);
}