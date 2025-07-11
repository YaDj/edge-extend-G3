import { createProgram, loadShaderSource, createTexture, createFramebuffer } from './utils.js';

// --- Елементи DOM, WebGL контекст ---
const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2', { alpha: true, antialias: true });
if (!gl) { throw new Error('WebGL2 not available'); }

const radiusSlider = document.getElementById('radiusSlider');
const radiusLabel = document.getElementById('radiusLabel');
const saveBtn = document.getElementById('saveBtn');
const saveAlphaButton = document.getElementById('saveAlphaButton');
const imageLoader = document.getElementById('imageLoader');
const shrinkAmountSlider = document.getElementById('shrinkAmountSlider');
const shrinkAmountLabel = document.getElementById('shrinkAmountLabel');
const shrinkBlurSlider = document.getElementById('shrinkBlurSlider');
const shrinkBlurLabel = document.getElementById('shrinkBlurLabel');
const blendCheckbox = document.getElementById('blendCheckbox');

// --- Глобальні змінні ---
let programBlur, programFinal;
let originalTexture, fbo1, fbo2, outputFBO, fboShrunk, fboHardMatte, fboColorFill, fboSoftMatte;
let quadBuffer;
let imageSize = [0, 0];
let currentImage = null;
let originalFileName = 'image';
let shrinkAmount = 1.0;
let shrinkBlur = 0.0;
let showOriginalOnTop = true;
let scale = 1.0;
let panX = 0.0;
let panY = 0.0;
let isPanning = false;
let lastMouseX = 0;
let lastMouseY = 0;
let debugChannel = 1; // 1 = RGB, 2 = Alpha
let debugPass = 0;

// --- Оголошення ВСІХ функцій-помічників ---

function drawFullScreenQuad() {
	const data = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
}

function resizeCanvasToDisplaySize() {
	const dpr = window.devicePixelRatio || 1;
	const displayWidth = Math.round(canvas.clientWidth * dpr);
	const displayHeight = Math.round(canvas.clientHeight * dpr);
	if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
		canvas.width = displayWidth;
		canvas.height = displayHeight;
		return true;
	}
	return false;
}

function drawPass(program, inputTexture, uniforms = {}) {
	gl.useProgram(program);
	const posLoc = gl.getAttribLocation(program, 'a_position');
	gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
	gl.enableVertexAttribArray(posLoc);
	gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, inputTexture);
	gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
	if (uniforms.radius !== undefined) gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), uniforms.radius);
	if (uniforms.texelSize) gl.uniform2fv(gl.getUniformLocation(program, 'u_texelSize'), uniforms.texelSize);
	if (uniforms.direction) gl.uniform2fv(gl.getUniformLocation(program, 'u_direction'), uniforms.direction);
	if (uniforms.shrinkAmount !== undefined) gl.uniform1f(gl.getUniformLocation(program, 'u_shrinkAmount'), uniforms.shrinkAmount);
	if (uniforms.shrinkBlur !== undefined) gl.uniform1f(gl.getUniformLocation(program, 'u_shrinkBlur'), uniforms.shrinkBlur);
	if (uniforms.threshold !== undefined) {
		gl.uniform1f(gl.getUniformLocation(program, 'u_threshold'), uniforms.threshold);
	}
	if (uniforms.texture2) {
		gl.activeTexture(gl.TEXTURE1); // Використовуємо інший текстурний слот
		gl.bindTexture(gl.TEXTURE_2D, uniforms.texture2);
		gl.uniform1i(gl.getUniformLocation(program, 'u_image2'), 1);
	}
	if (uniforms.debugMode !== undefined) {
		gl.uniform1f(gl.getUniformLocation(program, 'u_debugMode'), uniforms.debugMode);
	}
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function render() {
	if (!originalTexture) return;

	const [imgW, imgH] = imageSize;
	const texelSize = [1 / imgW, 1 / imgH];

	drawFullScreenQuad();
	gl.disable(gl.BLEND);

	// --- Крок 1: Blur1 (розмиття RGBA) -> fbo2 ---
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo1.fbo);
	gl.viewport(0, 0, imgW, imgH);
	drawPass(programBlur, originalTexture, { radius: 10.0, texelSize, direction: [1, 0] });

	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo2.fbo);
	gl.viewport(0, 0, imgW, imgH);
	drawPass(programBlur, fbo1.texture, { radius: 10.0, texelSize, direction: [0, 1] });


	// --- КРОК 2: MatteControl1 -> fboHardMatte ---
	gl.bindFramebuffer(gl.FRAMEBUFFER, fboHardMatte.fbo);
	gl.viewport(0, 0, imgW, imgH);
	gl.clearColor(0, 0, 0, 0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	drawPass(programFinal, originalTexture, {
		shrinkAmount: -3.0, // Сигнал для режиму MatteControl
		threshold: 0.99,    // Це значення зараз ігнорується, але залишмо його
		texture2: fbo2.texture
	});

	// --- КРОК 3a: Blur2 -> fboColorFill ---
	// Очищення тут теж не є строго необхідним, але додамо для чистоти експерименту.
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo1.fbo);
	gl.viewport(0, 0, imgW, imgH);
	gl.clearColor(0, 0, 0, 0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	drawPass(programBlur, fboHardMatte.texture, { radius: 10.9, texelSize, direction: [1, 0] });

	// Прохід по Y: fbo1 -> fboColorFill
	gl.bindFramebuffer(gl.FRAMEBUFFER, fboColorFill.fbo);
	gl.viewport(0, 0, imgW, imgH);
	gl.clearColor(0, 0, 0, 0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	drawPass(programBlur, fbo1.texture, { radius: 10.9, texelSize, direction: [0, 1] });


	// --- ЕТАП 2: Вирішуємо, що показати на екрані ---
	let textureToDraw;
	let uniformsToDraw = {};
	let enableBlend = false;

	switch (debugPass) {
		case 1: // Дебаг: результат Blur1 (розмитий оригінал)
			textureToDraw = fbo2.texture;
			uniformsToDraw = { shrinkBlur: -1.0 };
			enableBlend = true;
			break;

		case 2: // Дебаг: результат MatteControl1 (жорстка маска)
			textureToDraw = fboHardMatte.texture;
			uniformsToDraw = { shrinkBlur: -1.0 };
			enableBlend = true;
			break;

		case 5: // Дебаг: результат Blur2 (розмита жорстка маска)
			textureToDraw = fboColorFill.texture;
			// Передаємо сигнал для візуалізації каналів
			uniformsToDraw = { shrinkAmount: -5.0, debugMode: debugChannel };
			enableBlend = false;
			break;

		default: // Стандартний режим (поки що просто показуємо результат кроку 2)
			textureToDraw = fboHardMatte.texture;
			uniformsToDraw = { shrinkBlur: -1.0 };
			enableBlend = true;
			break;
	}

	// --- ЕТАП 3: Малюємо обрану текстуру на екран ---
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.clearColor(0.0, 0.0, 0.0, 0.0);
	gl.clear(gl.COLOR_BUFFER_BIT);

	const vpX = Math.round((gl.canvas.width / 2) - (imgW * scale / 2) + panX);
	const vpY = Math.round((gl.canvas.height / 2) - (imgH * scale / 2) - panY);
	gl.viewport(vpX, vpY, Math.round(imgW * scale), Math.round(imgH * scale));

	if (textureToDraw) {
		if (enableBlend) {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		} else {
			gl.disable(gl.BLEND);
		}
		drawPass(programFinal, textureToDraw, uniformsToDraw);
		if (enableBlend) {
			gl.disable(gl.BLEND);
		}
	}
}

function setupResources() {
	if (!currentImage) return;
	imageSize = [currentImage.width, currentImage.height];
	if (originalTexture) gl.deleteTexture(originalTexture);
	originalTexture = createTexture(gl, currentImage);

	// Видаляємо всі старі FBO, включаючи нові
	if (fbo1) { gl.deleteFramebuffer(fbo1.fbo); gl.deleteTexture(fbo1.texture); }
	if (fbo2) { gl.deleteFramebuffer(fbo2.fbo); gl.deleteTexture(fbo2.texture); }
	if (outputFBO) { gl.deleteFramebuffer(outputFBO.fbo); gl.deleteTexture(outputFBO.texture); }
	if (fboShrunk) { gl.deleteFramebuffer(fboShrunk.fbo); gl.deleteTexture(fboShrunk.texture); }
	if (fboHardMatte) { gl.deleteFramebuffer(fboHardMatte.fbo); gl.deleteTexture(fboHardMatte.texture); }
	if (fboColorFill) { gl.deleteFramebuffer(fboColorFill.fbo); gl.deleteTexture(fboColorFill.texture); }
	if (fboSoftMatte) { gl.deleteFramebuffer(fboSoftMatte.fbo); gl.deleteTexture(fboSoftMatte.texture); }

	// Створюємо всі FBO з актуальним розміром
	fbo1 = createFramebuffer(gl, imageSize[0], imageSize[1]);
	fbo2 = createFramebuffer(gl, imageSize[0], imageSize[1]);
	outputFBO = createFramebuffer(gl, imageSize[0], imageSize[1]);
	fboShrunk = createFramebuffer(gl, imageSize[0], imageSize[1]);
	fboHardMatte = createFramebuffer(gl, imageSize[0], imageSize[1]);
	fboColorFill = createFramebuffer(gl, imageSize[0], imageSize[1]);
	fboSoftMatte = createFramebuffer(gl, imageSize[0], imageSize[1]);

	render();
}

function handleImageUpload(event) {
	const file = event.target.files[0];
	if (!file) return;
	originalFileName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
	const img = new Image();
	img.onload = () => { currentImage = img; setupResources(); URL.revokeObjectURL(img.src); };
	img.src = URL.createObjectURL(file);
}

function saveAsJPG() {
	if (!currentImage) { alert("Зображення ще не завантажене."); return; }
	render();

	const [width, height] = imageSize;
	gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO.fbo);
	const pixels = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	const canvas2d = document.createElement('canvas');
	canvas2d.width = width;
	canvas2d.height = height;
	const ctx = canvas2d.getContext('2d');
	const imageData = ctx.createImageData(width, height);

	const rowSize = width * 4;
	for (let y = 0; y < height; y++) {
		const srcRow = pixels.subarray(y * rowSize, (y + 1) * rowSize);
		imageData.data.set(srcRow, (height - 1 - y) * rowSize);
	}

	ctx.putImageData(imageData, 0, 0);

	const link = document.createElement('a');
	link.download = `${originalFileName}.jpg`;
	link.href = canvas2d.toDataURL('image/jpeg', 0.95);
	link.click();
}

function saveAlphaMask() {
	if (!currentImage) { alert("Зображення ще не завантажене."); return; }
	const [width, height] = imageSize;
	const tempFBO = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, originalTexture, 0);
	const pixels = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.deleteFramebuffer(tempFBO);
	const rowSize = width * 4;
	const output = new Uint8ClampedArray(pixels.length);
	for (let y = 0; y < height; ++y) {
		const src = pixels.subarray(y * rowSize, (y + 1) * rowSize);
		const dstRow = (height - 1 - y) * rowSize;
		for (let x = 0; x < rowSize; x += 4) {
			const alpha = src[x + 3];
			output[dstRow + x + 0] = alpha;
			output[dstRow + x + 1] = alpha;
			output[dstRow + x + 2] = alpha;
			output[dstRow + x + 3] = 255;
		}
	}
	const canvas2d = document.createElement('canvas');
	canvas2d.width = width;
	canvas2d.height = height;
	const ctx = canvas2d.getContext('2d');
	ctx.putImageData(new ImageData(output, width, height), 0, 0);
	const link = document.createElement('a');
	link.download = `${originalFileName}_alpha.png`;
	link.href = canvas2d.toDataURL('image/png');
	link.click();
}

// --- Головна функція ---
async function main() {
	// Завантажуємо 3 шейдери
	const [vsSource, fsBlurSource, fsFinalSource] = await Promise.all([
		loadShaderSource('shaders/vertex.glsl'),
		loadShaderSource('shaders/blur.glsl'),
		loadShaderSource('shaders/final.glsl')
	]);

	programBlur = createProgram(gl, vsSource, fsBlurSource);
	programFinal = createProgram(gl, vsSource, fsFinalSource);

	if (!programBlur || !programFinal) { return; }

	quadBuffer = gl.createBuffer();
	drawFullScreenQuad();
	resizeCanvasToDisplaySize();

	imageLoader.addEventListener('change', handleImageUpload);
	radiusSlider.addEventListener('input', render);
	shrinkAmountSlider.addEventListener('input', () => { shrinkAmount = parseFloat(shrinkAmountSlider.value); shrinkAmountLabel.textContent = shrinkAmount.toFixed(1); render(); });
	shrinkBlurSlider.addEventListener('input', () => { shrinkBlur = parseFloat(shrinkBlurSlider.value); shrinkBlurLabel.textContent = shrinkBlur.toFixed(1); render(); });
	blendCheckbox.addEventListener('change', () => { showOriginalOnTop = blendCheckbox.checked; render(); });
	saveBtn.addEventListener('click', saveAsJPG);
	saveAlphaButton.addEventListener('click', saveAlphaMask);

	window.addEventListener('resize', () => { resizeCanvasToDisplaySize(); render(); });

	// --- НОВІ ОБРОБНИКИ ---
	canvas.addEventListener('wheel', handleWheel);
	canvas.addEventListener('mousedown', handleMouseDown);
	window.addEventListener('mousemove', handleMouseMove); // слухаємо на window, щоб не втрачати фокус
	window.addEventListener('mouseup', handleMouseUp);
	canvas.addEventListener('dblclick', handleDoubleClick);
	canvas.style.cursor = 'grab';
	// НОВИЙ ОБРОБНИК ДЛЯ ДЕБАГУ
	window.addEventListener('keydown', (event) => {
		switch (event.key) {
			case '0': debugPass = 0; break; // Нормальний режим
			case '1': debugPass = 1; break; // Показати фон
			case '2': debugPass = 2; break; // Показати чіткий шар
			case '5': debugPass = 5; break;// ДЕБАГ: Перевірка результату роботи Blur2 (fboColorFill)
			case 'c': // Перемикання каналів
				debugChannel = (debugChannel === 1) ? 2 : 1;
				console.log(`Switched to channel view: ${debugChannel === 1 ? 'RGB' : 'Alpha'}`);
				break;
			default: return; // Ігнорувати інші клавіші
		}
		event.preventDefault();
		render(); // Перемалювати сцену в новому режимі
	});
	const defaultImg = new Image();
	defaultImg.onload = () => { currentImage = defaultImg; setupResources(); };
	defaultImg.onerror = () => console.warn("Default image 'image.png' not found.");
	defaultImg.src = 'image.png';
}

// --- ОБРОБНИКИ ПОДІЙ ДЛЯ ЗУМУ ТА ПАНОРАМУВАННЯ ---

function handleWheel(event) {
	event.preventDefault();

	const zoomSpeed = 0.1;
	const delta = event.deltaY > 0 ? -1 : 1;

	// Просто змінюємо масштаб. Не чіпаємо panX і panY.
	scale *= (1 + delta * zoomSpeed);
	scale = Math.max(0.1, Math.min(scale, 30)); // Обмежуємо зум

	render();
}

function handleMouseDown(event) {
	isPanning = true;
	lastMouseX = event.clientX;
	lastMouseY = event.clientY;
	canvas.style.cursor = 'grabbing';
}

function handleMouseMove(event) {
	if (!isPanning) return;
	const dx = event.clientX - lastMouseX;
	const dy = event.clientY - lastMouseY;
	panX += dx;
	panY += dy;
	lastMouseX = event.clientX;
	lastMouseY = event.clientY;
	render();
}

function handleMouseUp() {
	isPanning = false;
	canvas.style.cursor = 'grab';
}

function handleDoubleClick() {
	// Скидаємо зум і позицію
	scale = 1.0;
	panX = 0.0;
	panY = 0.0;
	render();
}

// --- Запуск програми ---
main();