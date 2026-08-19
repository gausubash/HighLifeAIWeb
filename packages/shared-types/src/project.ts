export interface Project {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  jurisdiction: string;
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  jurisdiction: string;
  policyVersion: string;
}
