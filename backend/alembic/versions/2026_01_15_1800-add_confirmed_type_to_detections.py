"""add confirmed_type to detections

Revision ID: abc123def456
Revises: 4b65bbc80611
Create Date: 2026-01-15 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'abc123def456'
down_revision = '4b65bbc80611'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add confirmed_type column to detections table
    op.add_column('detections', sa.Column('confirmed_type', sa.String(), nullable=True))


def downgrade() -> None:
    # Remove confirmed_type column from detections table
    op.drop_column('detections', 'confirmed_type')
