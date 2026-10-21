"""owner tools

New settings for stage 6: default low-stock alert, email receipt after payment, daily summary time (23:59)
and an alert address that defaults to the owner's log-in email. Data only; no schema change.

Revision ID: 0006
Revises: 0005
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""UPDATE settings SET value = jsonb_build_object('default_low_stock_alert', 5) || value WHERE key = 'orders'""")
    op.execute("""UPDATE settings SET value = jsonb_build_object('email_after_payment', false) || value WHERE key = 'receipt'""")
    op.execute(
        """UPDATE settings SET value = (jsonb_build_object('daily_time', '23:59') || value)
             || CASE WHEN value->>'email' = '[OWNER EMAIL]' THEN '{"email": ""}'::jsonb ELSE '{}'::jsonb END
           WHERE key = 'owner_alerts'"""
    )


def downgrade() -> None:
    op.execute("UPDATE settings SET value = value - 'default_low_stock_alert' WHERE key = 'orders'")
    op.execute("UPDATE settings SET value = value - 'email_after_payment' WHERE key = 'receipt'")
    op.execute("UPDATE settings SET value = value - 'daily_time' WHERE key = 'owner_alerts'")
