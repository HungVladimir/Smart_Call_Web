"""Kiểm thử importer không cần đọc secret thật hoặc kết nối dịch vụ."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from import_reference_env import assignments, merge_reference


class ReferenceEnvTests(unittest.TestCase):
    """Đảm bảo mapping đúng và không mang credential không liên quan sang SmartCall."""
    def test_import_required_values_and_preserve_wazo(self):
        """Lấy thông tin từ mẫu, giữ cấu hình Wazo/CA và bỏ qua database/RDP."""
        source = """ONEAI_IDP__ISSUER=https://idp.fixture/oauth2/token
ONEAI_IDP__CLIENT_ID=fixture-client
ONEAI_IDP__CLIENT_SECRET=fixture-secret
ONEAI_IDP__CALLBACK_URI=http://localhost:8800/api/auth/callback
ONEAI_REDIS__URL=redis://:fixture@localhost:6379/0
ONEAI_REDIS__TTL=43200
ONEAI_RDP__PASSWORD=unrelated-secret
"""
        current = "SMARTCALL_WAZO_ADMIN_USERNAME=existing\nSMARTCALL_TLS_CA_FILE=company.pem\n"
        template = "SMARTCALL_IDP_CLIENT_ID=\nSMARTCALL_WAZO_DEFAULT_PASSWORD=12345\n"
        output, names = merge_reference(source, current, template)
        values = assignments(output)
        self.assertEqual(values["SMARTCALL_IDP_CLIENT_SECRET"], "fixture-secret")
        self.assertEqual(values["SMARTCALL_IDP_JWKS_URI"], "https://idp.fixture/t/display.company/oauth2/jwks")
        self.assertEqual(values["SMARTCALL_PUBLIC_ORIGIN"], "http://localhost:8800")
        self.assertEqual(values["SMARTCALL_WAZO_ADMIN_USERNAME"], "existing")
        self.assertEqual(values["SMARTCALL_TLS_CA_FILE"], "company.pem")
        self.assertNotIn("unrelated-secret", output)
        self.assertIn("SMARTCALL_REDIS_URL", names)

    def test_idempotent_and_reject_unexpected_callback(self):
        """Chạy lại không tạo biến trùng; không âm thầm chuyển callback sai."""
        reference = "ONEAI_IDP__CLIENT_ID=fixture"
        output, _ = merge_reference(reference, "", "SMARTCALL_IDP_CLIENT_ID=\n")
        again, _ = merge_reference(reference, output, "SMARTCALL_IDP_CLIENT_ID=\n")
        self.assertEqual(output, again)
        with self.assertRaises(ValueError):
            merge_reference("ONEAI_IDP__CALLBACK_URI=https://fixture/unexpected", "", "")
