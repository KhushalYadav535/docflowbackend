-- Create folder_permissions table for folder-level permission overrides
CREATE TABLE IF NOT EXISTS folder_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT true NOT NULL,
  can_upload BOOLEAN DEFAULT false NOT NULL,
  can_edit BOOLEAN DEFAULT false NOT NULL,
  can_delete BOOLEAN DEFAULT false NOT NULL,
  can_manage BOOLEAN DEFAULT false NOT NULL,
  CONSTRAINT folder_permissions_role_user_check CHECK (
    (role_id IS NOT NULL AND user_id IS NULL) OR
    (role_id IS NULL AND user_id IS NOT NULL)
  ),
  CONSTRAINT folder_permissions_unique_role UNIQUE (folder_id, role_id),
  CONSTRAINT folder_permissions_unique_user UNIQUE (folder_id, user_id)
);

CREATE INDEX idx_folder_permissions_folder ON folder_permissions(folder_id);
CREATE INDEX idx_folder_permissions_role ON folder_permissions(role_id);
CREATE INDEX idx_folder_permissions_user ON folder_permissions(user_id);
