import { createProgram, loadShaderSource, createTexture, createFramebuffer } from './utils.js';

// --- Елементи DOM, WebGL контекст ---
const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
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
let originalTexture, fbo1, fbo2, outputFBO, fboShrunk, fboShrunkBlurred;
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
let debugPass = 0; // 0=Normal, 1=BG, 2=Aura, 3=Shrunk

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
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function render() {
	if (!originalTexture) return;

	// --- Етап 1 і 2: ЗАВЖДИ генеруємо всі дані ---
	const radius = parseFloat(radiusSlider.value);
	const shrinkBlurValue = parseFloat(shrinkBlurSlider.value);
	radiusLabel.textContent = radius.toFixed(1);
	const [imgW, imgH] = imageSize;
	const texelSize = [1 / imgW, 1 / imgH];
	drawFullScreenQuad();
	gl.disable(gl.BLEND);

	// Етап 1: Рендер розмитого фону -> fbo2
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo1.fbo);
	gl.viewport(0, 0, imgW, imgH);
	drawPass(programBlur, originalTexture, { radius, texelSize, direction: [1, 0] });
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo2.fbo);
	gl.viewport(0, 0, imgW, imgH);
	drawPass(programBlur, fbo1.texture, { radius, texelSize, direction: [0, 1] });

	// Етап 2: Створення шарів ерозії, якщо потрібно
	if (showOriginalOnTop) {
		// 2a: Створюємо чіткий шар ерозії -> fboShrunk
		gl.bindFramebuffer(gl.FRAMEBUFFER, fboShrunk.fbo);
		gl.viewport(0, 0, imgW, imgH);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		drawPass(programFinal, originalTexture, { shrinkAmount, shrinkBlur: shrinkBlurValue, texelSize });

		// 2b: Розмиваємо результат ерозії ("аура") -> fboShrunkBlurred
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo1.fbo);
		gl.viewport(0, 0, imgW, imgH);
		drawPass(programBlur, fboShrunk.texture, { radius: shrinkBlurValue, texelSize, direction: [1, 0] });
		gl.bindFramebuffer(gl.FRAMEBUFFER, fboShrunkBlurred.fbo);
		gl.viewport(0, 0, imgW, imgH);
		drawPass(programBlur, fbo1.texture, { radius: shrinkBlurValue, texelSize, direction: [0, 1] });
	}

	// --- Етап 3: Відображення на екран ---

	// 3a. Визначаємо, що саме малювати
	let textureToDraw;
	let uniformsToDraw = {};
	let enableBlend = false;

	switch (debugPass) {
		case 1:
			textureToDraw = fbo2.texture;
			uniformsToDraw = { shrinkAmount: -1.0 };
			break;
		case 2:
			if (showOriginalOnTop) {
				textureToDraw = fboShrunkBlurred.texture;
				uniformsToDraw = { shrinkBlur: -1.0 };
				enableBlend = true;
			}
			break;
		case 3:
			if (showOriginalOnTop) {
				textureToDraw = fboShrunk.texture;
				uniformsToDraw = { shrinkBlur: -1.0 };
				enableBlend = true;
			}
			break;
		case 4: // ДЕБАГ: Бленд тільки Шару 2 і Шару 3
			if (showOriginalOnTop) {
				console.log("DEBUG: Showing Layer 2 + Layer 3 blend");

				// Малюємо в наш проміжний буфер, щоб отримати результат їх змішування
				gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO.fbo);
				gl.viewport(0, 0, imgW, imgH);
				gl.clearColor(0, 0, 0, 0); // Починаємо з чистого прозорого листа
				gl.clear(gl.COLOR_BUFFER_BIT);

				// Вмикаємо блендінг
				gl.enable(gl.BLEND);
				gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

				// Малюємо Шар 2 ("Аура")
				drawPass(programFinal, fboShrunkBlurred.texture, { shrinkBlur: -1.0 });

				// Поверх нього малюємо Шар 3 (Чіткий край)
				drawPass(programFinal, fboShrunk.texture, { shrinkBlur: -1.0 });

				gl.disable(gl.BLEND);

				// Тепер налаштовуємо вивід цього результату на екран
				textureToDraw = outputFBO.texture;
				uniformsToDraw = { shrinkBlur: -1.0 }; // Просто копіюємо
				enableBlend = true; // Результат прозорий, тому потрібен блендінг з фоном екрану
			}
			break;

		default: // Стандартний режим
			// Створюємо фінальну композицію в outputFBO
			gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO.fbo);
			gl.viewport(0, 0, imgW, imgH);
			// Очищуємо до ПРОЗОРОГО чорного, щоб було з чим змішувати
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);

			// --- НОВА, ПРАВИЛЬНА ЛОГІКА ---
			// 1. Спочатку виправляємо колір фону і зберігаємо його в тимчасовий fbo1
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo1.fbo);
			drawPass(programFinal, fbo2.texture, { shrinkAmount: -2.0 });

			// 2. Тепер малюємо цей виправлений фон в outputFBO, одразу конвертуючи його в premultiplied alpha
			gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO.fbo);
			drawPass(programFinal, fbo1.texture, { shrinkAmount: 0, shrinkBlur: 0 });

			// 3. Тепер всі шари в одному форматі, і блендінг спрацює
			if (showOriginalOnTop) {
				gl.enable(gl.BLEND);
				gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
				// Шар 2: Аура
				drawPass(programFinal, fboShrunkBlurred.texture, { shrinkBlur: -1.0 });
				// Шар 3: Чіткий край
				drawPass(programFinal, fboShrunk.texture, { shrinkBlur: -1.0 });
				gl.disable(gl.BLEND);
			}

			// Налаштовуємо, щоб на екран малювався результат з outputFBO
			textureToDraw = outputFBO.texture;
			uniformsToDraw = { shrinkBlur: -1.0 };
			// Малюємо на екран, який має свій чорний фон, тому прозорість буде виглядати правильно.
			enableBlend = true;
			break;
	}

	// 3b. Виконуємо фінальний малюнок на екран
	// --- ОСНОВНЕ ВИПРАВЛЕННЯ ---
	// ЗАВЖДИ переконуємось, що ми малюємо на екран (null), а не в останній активний FBO.
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	gl.clearColor(0.2, 0.2, 0.2, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);

	const vpX = Math.round((gl.canvas.width / 2) - (imgW * scale / 2) + panX);
	const vpY = Math.round((gl.canvas.height / 2) - (imgH * scale / 2) - panY);
	const vpW = Math.round(imgW * scale);
	const vpH = Math.round(imgH * scale);
	gl.viewport(vpX, vpY, vpW, vpH);

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
	if (fboShrunkBlurred) { gl.deleteFramebuffer(fboShrunkBlurred.fbo); gl.deleteTexture(fboShrunkBlurred.texture); }

	// Створюємо всі FBO з актуальним розміром
	fbo1 = createFramebuffer(gl, imageSize[0], imageSize[1]);
	fbo2 = createFramebuffer(gl, imageSize[0], imageSize[1]);
	outputFBO = createFramebuffer(gl, imageSize[0], imageSize[1]);
	fboShrunk = createFramebuffer(gl, imageSize[0], imageSize[1]);
	fboShrunkBlurred = createFramebuffer(gl, imageSize[0], imageSize[1]);

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
	const [vsSource, fsBlurSource, fsFinalSource] = await Promise.all([
		loadShaderSource('shaders/vertex.glsl'),
		loadShaderSource('shaders/blur.glsl'),
		loadShaderSource('shaders/final.glsl'),
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
			case '2': debugPass = 2; break; // Показати "ауру"
			case '3': debugPass = 3; break; // Показати чіткий шар
			case '4': debugPass = 4; break;
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