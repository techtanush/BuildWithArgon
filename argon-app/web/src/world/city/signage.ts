// OWNER: mahin
import * as THREE from "three";
export function textSign(text: string, subtitle = "", width = 3): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#242a25";
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = "#a99b74";
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, 1000, 232);
  ctx.fillStyle = "#f3efdf";
  ctx.textAlign = "center";
  ctx.font = "500 68px Georgia";
  ctx.fillText(text, 512, 115, 940);
  ctx.fillStyle = "#b8b7a7";
  ctx.font = "24px system-ui";
  ctx.fillText(subtitle.toUpperCase(), 512, 178, 940);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4),
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  mesh.userData.ownedTexture = texture;
  return mesh;
}
