import React, { useRef, useEffect } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import * as THREE from "three";
import heartModel from "./heart.glb";

function HeartModel3D({ heartRate = 72, emergency = false }) {
  const mountRef = useRef(null);
  const heartGroupRef = useRef(null);
  const baseScaleRef = useRef(1);
  const labelsRef = useRef([]);

  useEffect(() => {
    if (!mountRef.current) return;

    /* ---------------- SCENE ---------------- */
    const scene = new THREE.Scene();

    /* ---------------- CAMERA ---------------- */
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 6);

    /* ---------------- RENDERER ---------------- */
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);

    /* ---------------- LIGHTS ---------------- */
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    /* ---------------- HEART MODEL ---------------- */
    const loader = new GLTFLoader();
    loader.load(
      heartModel,
      (gltf) => {
        const heart = gltf.scene;

        // 🔒 Locked parent group
        const heartGroup = new THREE.Group();
        heartGroup.position.set(0, 0, 0);
        scene.add(heartGroup);
        heartGroupRef.current = heartGroup;

        heart.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              color: emergency ? 0xff5252 : 0xc89b7b,
              roughness: 0.4,
              metalness: 0.25,
            });
          }
        });

        // Center heart inside group
        const box = new THREE.Box3().setFromObject(heart);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        heart.position.sub(center);

        const scale = 2.6 / Math.max(size.x, size.y, size.z);
        heart.scale.setScalar(scale);
        baseScaleRef.current = scale;

        heartGroup.add(heart);
      },
      undefined,
      (err) => console.error("Heart GLB load error:", err)
    );

    /* ---------------- FLOATING TEXT ---------------- */
    const createLabel = (text, radius, angle) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      canvas.width = 512;
      canvas.height = 128;

      ctx.font = "bold 42px Arial";
      ctx.fillStyle = emergency ? "#ff5252" : "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(text, 256, 80);

      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
      });

      const sprite = new THREE.Sprite(material);
      sprite.scale.set(1.8, 0.45, 1);
      sprite.userData = { radius, angle };

      scene.add(sprite);
      labelsRef.current.push(sprite);
    };

    createLabel("Heart Rate", 2.8, 0);
    createLabel(`${heartRate} BPM`, 3.3, Math.PI / 2);
    createLabel(emergency ? "EMERGENCY" : "NORMAL", 2.8, Math.PI);

    /* ---------------- RESIZE ---------------- */
    const resize = () => {
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    /* ---------------- ANIMATION ---------------- */
    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);

      if (heartGroupRef.current) {
        heartGroupRef.current.rotation.y += 0.004;

        const t = performance.now() * 0.001;
        const pulse =
          1 +
          Math.sin(t * (heartRate / 60) * Math.PI * 2) *
            0.08;

        const s = baseScaleRef.current * pulse;
        heartGroupRef.current.scale.setScalar(s);
      }

      // Orbiting labels
      labelsRef.current.forEach((label, i) => {
        label.userData.angle += 0.003 + i * 0.001;
        label.position.set(
          Math.cos(label.userData.angle) *
            label.userData.radius,
          Math.sin(label.userData.angle * 0.6) * 0.4,
          Math.sin(label.userData.angle) *
            label.userData.radius
        );
        label.lookAt(camera.position);
      });

      renderer.render(scene, camera);
    };

    animate();

    /* ---------------- CLEANUP ---------------- */
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      if (mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, [heartRate, emergency]);

  return (
    <div
      ref={mountRef}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

export default HeartModel3D;