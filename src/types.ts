export type Vec3 = { x: number; y: number; z: number };

export type RigJointDef = {
  id: string;
  name: string;
};

export type RigGroupDef = {
  joints: string[];
  label?: string;
};

export type RigProfileId = "vitpose_body_17" | "dwpose_body_25";

export type RigProfile = {
  id: RigProfileId;
  label: string;
  joints: RigJointDef[];
  bones: [string, string][];
  groups: Record<string, RigGroupDef>;
  restPose: Record<string, Vec3>;
};

export type RigDefinition = {
  joints: { id: string; name?: string }[];
  bones: [string, string][];
  defaultRest: Record<string, number>;
  groups: Record<string, RigGroupDef>;
};
