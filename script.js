import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';
// import CannonDebugger from 'three/addons/physics/CannonDebugger.js'; // 可選，用於調試物理形狀

// --- 基本設定 ---
let scene, camera, renderer, controls;
let world, cannonDebugger; // 物理世界和調試器
const objectsToUpdate = []; // 需要同步物理和視覺的物體
const textureLoader = new THREE.TextureLoader();
// --- 移除拖曳相關變數 ---
// const raycaster = new THREE.Raycaster();
// const mouse = new THREE.Vector2();
// let draggableDice = null; // 目前正在拖曳的骰子
// let planeIntersect = new THREE.Vector3(); // 滑鼠在拖曳平面上的交點
// const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // 用於計算拖曳位置的隱形平面
// let shift = new THREE.Vector3(); // 拖曳時的偏移量
// let isDragging = false;
let diceToDrop = null; // 等待被投放的骰子

// --- DOM 元素 ---
const canvas = document.getElementById('c');
const canvasContainer = document.getElementById('canvas-container');
const resultDiv = document.getElementById('result');
// 移除 Add Dice 按鈕引用
// const addDiceBtn = document.getElementById('addDiceBtn');
const resetBtn = document.getElementById('resetBtn');

// --- 初始化 ---
function init() {
    // 場景
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xabcdef);

    // 相機
    camera = new THREE.PerspectiveCamera(75, canvasContainer.clientWidth / canvasContainer.clientHeight, 0.1, 1000);
    camera.position.set(5, 8, 15); // 調整相機初始位置

    // 渲染器
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    renderer.shadowMap.enabled = true; // 啟用陰影

    // 光照
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 5);
    directionalLight.castShadow = true;
    // 配置陰影品質
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    scene.add(directionalLight);

    // 控制器
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // 啟用阻尼效果，更平滑

    // 物理世界
    world = new CANNON.World({
        gravity: new CANNON.Vec3(0, -25, 0) // 加強重力
    });
    world.broadphase = new CANNON.SAPBroadphase(world); // 改善效能
    world.allowSleep = true; // 允許靜止的物體休眠以節省效能

    // 可選：物理調試器
    // cannonDebugger = new CannonDebugger(scene, world, { color: 0x00ff00 });

    // --- 創建元素 ---
    createGround();
    createDiceTower();
    // 改為準備骰子，而不是創建可拖曳的骰子
    prepareDice(); // 準備第一個要投放的骰子

    // --- 事件監聽 ---
    window.addEventListener('resize', onWindowResize);
    // 移除拖曳事件監聽
    // canvas.addEventListener('pointerdown', onPointerDown);
    // canvas.addEventListener('pointermove', onPointerMove);
    // canvas.addEventListener('pointerup', onPointerUp);
    // 移除 Add Dice 按鈕監聽
    // addDiceBtn.addEventListener('click', createDraggableDice);
    resetBtn.addEventListener('click', resetScene);
    // 新增鍵盤事件監聽
    window.addEventListener('keydown', onKeyDown);

    // 開始動畫循環
    animate();
}

// --- 創建地面 ---
function createGround() {
    // Three.js 地面
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2; // 水平放置
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Cannon.js 地面 (靜態)
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({ mass: 0 }); // mass = 0 代表靜態
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); // 與 Three.js 對應
    world.addBody(groundBody);
}

// --- 創建骰盅塔 ---
function createDiceTower() {
    const towerGroup = new THREE.Group();
    const towerMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513, // 棕色
        roughness: 0.8,
        metalness: 0.2
    });

    const towerHeight = 8;
    const towerWidth = 4;
    const wallThickness = 0.3;

    // 物理材質 (用於設定摩擦力和彈性)
    const towerPhysicsMaterial = new CANNON.Material('towerMaterial');
    const defaultContactMaterial = new CANNON.ContactMaterial(
        towerPhysicsMaterial,
        new CANNON.Material('diceMaterial'), // 稍後創建骰子時會定義
        { friction: 0.1, restitution: 0.3 } // 塔與骰子間的摩擦力和彈性
    );
    world.addContactMaterial(defaultContactMaterial);

    // 輔助函數：創建牆壁 (視覺 + 物理)
    const createWall = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
        // Three.js Mesh
        const geometry = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geometry, towerMaterial);
        mesh.position.set(x, y, z);
        mesh.rotation.set(rx, ry, rz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        towerGroup.add(mesh);

        // Cannon.js Body (靜態)
        const shape = new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2));
        const body = new CANNON.Body({ mass: 0, material: towerPhysicsMaterial });
        body.addShape(shape);
        body.position.set(x, y, z);
        body.quaternion.setFromEuler(rx, ry, rz);
        world.addBody(body);
    };

    // 塔身牆壁
    createWall(towerWidth, towerHeight, wallThickness, 0, towerHeight / 2, towerWidth / 2); // 後
    // 修改前牆：降低高度，提高位置，製造出口
    const exitHeight = 1.5; // 出口高度
    createWall(towerWidth, towerHeight - exitHeight, wallThickness, 0, towerHeight / 2 + exitHeight / 2, -towerWidth / 2); // 前 (變短，上移)
    createWall(wallThickness, towerHeight, towerWidth, towerWidth / 2, towerHeight / 2, 0); // 右
    createWall(wallThickness, towerHeight, towerWidth, -towerWidth / 2, towerHeight / 2, 0); // 左

    // 內部斜坡 (這是骰盅塔的關鍵)
    const rampWidth = towerWidth - wallThickness * 1.5; // 稍微窄一點避免卡住
    const rampThickness = 0.2;
    createWall(rampWidth, rampThickness, rampWidth, 0, towerHeight * 0.7, 0, 0, 0, Math.PI / 6); // 第一層斜坡 (向右下傾斜)
    createWall(rampWidth, rampThickness, rampWidth, 0, towerHeight * 0.4, 0, 0, 0, -Math.PI / 6); // 第二層斜坡 (向左下傾斜)
    createWall(rampWidth, rampThickness, rampWidth, 0, towerHeight * 0.1, 0, 0, 0, Math.PI / 7); // 第三層斜坡 (輕微向右下)

    // 底部擋板 (防止骰子直接滾出去太遠)
    createWall(towerWidth, 0.5, wallThickness, 0, 0.25, -towerWidth / 2 - 0.5, Math.PI / 8); // 前下擋板

    // 將塔加入場景
    scene.add(towerGroup);

     // 創建一個"觸發區域"，用於檢測骰子何時滾出
    const exitTriggerShape = new CANNON.Box(new CANNON.Vec3(towerWidth / 1.5, 0.5, towerWidth / 1.5));
    const exitTriggerBody = new CANNON.Body({
        isTrigger: true, // 設置為觸發器，不會產生碰撞反應，但能檢測碰撞事件
        mass: 0,
        position: new CANNON.Vec3(0, -0.5, -towerWidth / 2 - 1) // 放在出口前方稍低的位置
    });
    exitTriggerBody.addShape(exitTriggerShape);
    world.addBody(exitTriggerBody);

    exitTriggerBody.addEventListener('collide', (event) => {
        const collidedBody = event.body; // 獲取與觸發器碰撞的物體
        // 檢查碰撞的物體是否是一個骰子 (可以通過名稱或其他標識符)
        if (collidedBody.isDice) {
             // 短暫延遲後計算結果，確保骰子已穩定
             setTimeout(() => {
                if (!collidedBody.resultCalculated) { // 避免重複計算
                    getDiceResult(collidedBody);
                    collidedBody.resultCalculated = true; // 標記已計算
                }
            }, 1000); // 延遲 1 秒
        }
    });
}

// --- 創建骰子 ---
const diceSize = 1;
const diceHalfSize = diceSize / 2;
const diceGeometry = new THREE.BoxGeometry(diceSize, diceSize, diceSize);
const dicePhysicsMaterial = new CANNON.Material('diceMaterial'); // 用於前面定義的接觸材質

// 加載骰子貼圖 (確保路徑正確)
const diceMaterials = [
    new THREE.MeshStandardMaterial({ map: textureLoader.load('textures/dice-1.png') }), // 右 (+X)
    new THREE.MeshStandardMaterial({ map: textureLoader.load('textures/dice-6.png') }), // 左 (-X)
    new THREE.MeshStandardMaterial({ map: textureLoader.load('textures/dice-2.png') }), // 上 (+Y)
    new THREE.MeshStandardMaterial({ map: textureLoader.load('textures/dice-5.png') }), // 下 (-Y)
    new THREE.MeshStandardMaterial({ map: textureLoader.load('textures/dice-3.png') }), // 前 (+Z)
    new THREE.MeshStandardMaterial({ map: textureLoader.load('textures/dice-4.png') })  // 後 (-Z)
];

// **非常重要**：根據貼圖順序定義面和值的對應關係
// 這需要與你的貼圖和 Three.js BoxGeometry 的面順序匹配
const faceValues = {
    '+x': 1, '-x': 6,
    '+y': 2, '-y': 5,
    '+z': 3, '-z': 4
};
const faceAxes = [
    new CANNON.Vec3(1, 0, 0), new CANNON.Vec3(-1, 0, 0),
    new CANNON.Vec3(0, 1, 0), new CANNON.Vec3(0, -1, 0),
    new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(0, 0, -1)
];
const faceKeys = ['+x', '-x', '+y', '-y', '+z', '-z'];


function createDice(position) {
    // Three.js Mesh
    const diceMesh = new THREE.Mesh(diceGeometry, diceMaterials);
    diceMesh.castShadow = true;
    diceMesh.receiveShadow = true;
    diceMesh.position.copy(position);
    diceMesh.userData.isDice = true; // 添加標識符
    // 移除 isDraggable 標記
    // diceMesh.userData.isDraggable = isDraggable;
    scene.add(diceMesh);

    // Cannon.js Body (動態)
    const diceShape = new CANNON.Box(new CANNON.Vec3(diceHalfSize, diceHalfSize, diceHalfSize));
    const diceBody = new CANNON.Body({
        mass: 1, // 骰子質量
        shape: diceShape,
        material: dicePhysicsMaterial,
        allowSleep: true,
        sleepTimeLimit: 0.5, // 稍微快一點進入休眠
    });
    diceBody.position.copy(diceMesh.position);
    // 隨機初始旋轉 (保持)
    diceBody.quaternion.setFromEuler(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
    );
    // 移除初始角速度設定，讓它從靜止開始掉落
    // diceBody.angularVelocity.set(
    //     (Math.random() - 0.5) * 10,
    //     (Math.random() - 0.5) * 10,
    //     (Math.random() - 0.5) * 10
    // );
    diceBody.linearDamping = 0.1; // 線性阻尼
    diceBody.angularDamping = 0.4; // 角阻尼，幫助骰子更快穩定下來

    diceBody.isDice = true; // 添加標識符給物理體
    diceBody.userData = { mesh: diceMesh }; // 將 mesh 關聯到 body
    diceMesh.userData.body = diceBody; // 將 body 關聯到 mesh
    diceBody.resultCalculated = false; // 重置計算標誌

    // *** 重要：不再將 body 加入 world ***
    // if (!isDraggable) {
    //      world.addBody(diceBody);
    // }

    objectsToUpdate.push({ mesh: diceMesh, body: diceBody });

    return { mesh: diceMesh, body: diceBody };
}

// *** 函數重命名並修改邏輯 ***
// 準備一個骰子在塔頂，等待投放
function prepareDice() {
    clearResults(); // 清除之前的結果
    // 將生成位置改到塔頂上方
    const towerHeight = 8; // (假設 towerHeight 在此作用域可用，如果不行需要傳遞或設為全域)
    const spawnPos = new THREE.Vector3(0, towerHeight + 2, 0); // 放在塔的上方
    const newDice = createDice(spawnPos); // 創建骰子，但不加入物理世界
    diceToDrop = newDice; // 設置為等待投放的骰子
}


// --- 事件處理 ---
function onWindowResize() {
    camera.aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
}

// --- 移除拖曳處理函數 ---
// function onPointerDown(event) { ... }
// function onPointerMove(event) { ... }
// function onPointerUp(event) { ... }

// --- 新增鍵盤處理函數 ---
function onKeyDown(event) {
    if (event.key === 'Enter' && diceToDrop) {
        console.log("Enter pressed, dropping dice!"); // 調試信息

        // 將等待的骰子加入物理世界
        world.addBody(diceToDrop.body);

        // 可以給一點隨機的初始角速度，增加趣味性
        diceToDrop.body.angularVelocity.set(
             (Math.random() - 0.5) * 3,
             (Math.random() - 0.5) * 3,
             (Math.random() - 0.5) * 3
        );
        diceToDrop.body.wakeUp(); // 確保物理體是激活的

        // 清空等待投放的骰子引用
        diceToDrop = null;
    }
}


// --- 結果計算 ---
let currentResults = []; // 儲存當前掉落骰子的結果
function getDiceResult(diceBody) {
    // 確保物理體存在且有關聯的 mesh
    if (!diceBody || !diceBody.userData || !diceBody.userData.mesh) return;
    if (diceBody.sleepState !== CANNON.Body.SLEEPING && !diceBody.isTrigger) { // 只有當骰子大致停止時才計算，且不是觸發器本身
        // 可以增加一個檢查，如果速度還很快，則延遲計算
        const threshold = 0.2;
        if (diceBody.velocity.lengthSquared() > threshold || diceBody.angularVelocity.lengthSquared() > threshold) {
            // 還在移動，稍後再試
             setTimeout(() => getDiceResult(diceBody), 300);
             return;
        }
    }


    const up = new CANNON.Vec3(0, 1, 0); // 世界坐標系中的"上"方向
    let maxDot = -Infinity;
    let topFaceIndex = -1;

    // 遍歷每個可能的面向量 (在骰子的局部坐標系中)
    for (let i = 0; i < faceAxes.length; i++) {
        const localAxis = faceAxes[i];
        // 將局部坐標系的面向量轉換到世界坐標系
        const worldAxis = diceBody.vectorToWorldFrame(localAxis);
        // 計算轉換後的向量與世界"上"方向的點積
        const dot = worldAxis.dot(up);

        // 找到點積最大的那個面，它就是朝上的面
        if (dot > maxDot) {
            maxDot = dot;
            topFaceIndex = i;
        }
    }

    const resultValue = faceValues[faceKeys[topFaceIndex]];
    console.log(`骰子 ${diceBody.id} 滾出結果: ${resultValue}`); // 在控制台輸出

    if (!isNaN(resultValue)) {
         currentResults.push(resultValue);
         displayResults();
    } else {
         console.warn("無法確定骰子面:", diceBody.id, topFaceIndex);
         // 發生錯誤時，可能需要重新計算或標記
         setTimeout(() => {
            if (!diceBody.resultCalculated) { // 避免無限循環
                getDiceResult(diceBody);
            }
        }, 500);
    }
}

function displayResults() {
    if (currentResults.length > 0) {
        const sum = currentResults.reduce((a, b) => a + b, 0);
        resultDiv.textContent = `結果: ${currentResults.join(', ')} (總和: ${sum})`;
    } else {
        resultDiv.textContent = '結果: ';
    }
}

function clearResults() {
    currentResults = [];
    displayResults();
     // 重置所有骰子的計算標誌
    objectsToUpdate.forEach(obj => {
        if (obj.body && obj.body.isDice) {
            obj.body.resultCalculated = false;
        }
    });
}

// --- 重設場景 ---
function resetScene() {
    // 移除所有已在物理世界中的骰子
    objectsToUpdate.forEach(obj => {
        if (obj.mesh.userData.isDice) { // 只移除骰子
            scene.remove(obj.mesh);
            if (world.bodies.includes(obj.body)) {
                world.removeBody(obj.body);
            }
        }
    });
    // 如果有骰子正等待投放，也移除它的 mesh
    if (diceToDrop) {
        scene.remove(diceToDrop.mesh);
        diceToDrop = null;
    }

    objectsToUpdate.length = 0; // 清空數組

    // 清除結果
    clearResults();

    // 重置拖動狀態 (現在不需要了)
    // isDragging = false;
    // draggableDice = null;
    // controls.enabled = true;

    // 準備下一個要投放的骰子
    prepareDice();
}


// --- 動畫循環 ---
const clock = new THREE.Clock();
let lastTime = 0;

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const deltaTime = (time - lastTime) / 1000; // 秒
    lastTime = time;

    // 0. 更新控制器 (如果啟用了阻尼)
    controls.update();

    // 1. 推進物理世界
    if (world) {
        // 使用可變的時間步長，但限制最大步長以防止問題
         world.step(1 / 60, deltaTime, 3); // (固定時間步長, 真實經過時間, 最大子步數)
    }

    // 2. 同步 Three.js 物體和 Cannon.js 物體
    objectsToUpdate.forEach(obj => {
        // 移除 isDragging 檢查
        // if (!(isDragging && obj.mesh === draggableDice?.mesh)) {
             // 檢查 body 是否仍在 world 中 (這個檢查仍然需要)
             if (world.bodies.includes(obj.body)) {
                obj.mesh.position.copy(obj.body.position);
                obj.mesh.quaternion.copy(obj.body.quaternion);
             }
        // }

        // 檢查骰子是否停止滾動並且滾出了塔外 (觸發器處理了主要邏輯)
        // 可以在這裡加一個備用檢查，如果骰子睡著了且在塔外某區域，也計算結果
        // if(obj.body.isDice && !obj.body.resultCalculated && obj.body.sleepState === CANNON.Body.SLEEPING) {
        //     // 檢查位置是否在塔外
        //     if (obj.body.position.y < 0.5 && Math.abs(obj.body.position.z) > towerWidth / 2 + 0.5) {
        //          getDiceResult(obj.body);
        //          obj.body.resultCalculated = true;
        //     }
        // }
    });

     // 3. 更新物理調試器 (如果使用)
    // if (cannonDebugger) {
    //     cannonDebugger.update();
    // }

    // 4. 渲染場景
    renderer.render(scene, camera);
}

// --- 啟動 ---
init();

// --- 確保 towerHeight 可用 ---
// 如果 createDiceTower 中的 towerHeight 不是全域變數，
// 需要在 prepareDice 中能夠訪問到它。
// 最簡單的方式是將 towerHeight 定義在更外層的作用域，或者傳遞它。
// 假設目前 towerHeight 在 createDiceTower 中是局部常量，我們需要調整。
// 為了簡單起見，可以在 prepareDice 裡面重新定義 towerHeight。
// (在上面的修改中，我已經在 prepareDice 內部添加了 const towerHeight = 8;)