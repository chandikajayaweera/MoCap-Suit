from pygltflib import GLTF2

gltf = GLTF2().load("amy.glb")

# Print all node names (some of which are bones)
for i, node in enumerate(gltf.nodes):
    print(f"Node {i}: {node.name}")

# Optional: If the model has skins (skeletons), print joint indices
for skin in gltf.skins:
    print("Joints:")
    for joint_index in skin.joints:
        print(f" - {gltf.nodes[joint_index].name}")
