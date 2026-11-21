"""Kiểm thử DB thật trong thư mục tạm; không truy cập mapping hoặc tài khoản công ty."""
from contextlib import closing, redirect_stdout, redirect_stderr
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manage_identity_db import main


class IdentityDatabaseTests(unittest.TestCase):
    """Kiểm chứng add/list/delete và backup, không cho ghi đè mapping đã có."""
    def setUp(self):
        """Mỗi ca có đường dẫn riêng, không đọc .env hoặc database thật."""
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.database = Path(self.directory.name) / "identity.sqlite3"

    def command(self, *arguments):
        """Gọi CLI qua parser thật, giữ output để đối chiếu dữ liệu và mã kết thúc."""
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            result = main(["--db", str(self.database), *arguments])
        return result, output.getvalue()

    def add(self, subject="subject-1", user_uuid="user-1"):
        """Thêm mapping fixture; managed chỉ bật khi yêu cầu tường minh."""
        return self.command("add", "--issuer", "https://idp.fixture", "--subject", subject,
                            "--tenant", "tenant", "--user-uuid", user_uuid, "--username", "employee", "--managed")

    def test_add_list_delete_backups_preserve_other_mapping(self):
        """Xóa có phạm vi, backup giữ dòng cũ và identity NUL được tách khi hiển thị."""
        self.assertEqual(self.add()[0], 0)
        self.assertEqual(self.add("subject-2", "user-2")[0], 0)
        result, output = self.command("list", "--username", "employee")
        self.assertEqual(result, 0)
        records = json.loads(output)["items"]
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["issuer"], "https://idp.fixture")
        self.assertTrue(records[0]["managed"])
        self.assertEqual(self.command("delete", "--tenant", "tenant", "--user-uuid", "user-1")[0], 0)
        records = json.loads(self.command("list")[1])["items"]
        self.assertEqual([row["user_uuid"] for row in records], ["user-2"])
        backups = list(self.database.parent.glob("identity.sqlite3.backup-*"))
        self.assertEqual(len(backups), 2)
        with closing(sqlite3.connect(sorted(backups)[-1])) as database:
            self.assertEqual(database.execute("SELECT count(*) FROM identities").fetchone()[0], 2)

    def test_duplicate_mapping_does_not_overwrite(self):
        """Unique identity/tenant và tenant/UUID đều được bảo vệ."""
        self.assertEqual(self.add()[0], 0)
        self.assertEqual(self.add("subject-1", "other-user")[0], 1)
        self.assertEqual(self.add("other-subject", "user-1")[0], 1)
        records = json.loads(self.command("list")[1])["items"]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["user_uuid"], "user-1")

    def test_list_missing_database_does_not_create_file(self):
        """Gõ sai đường dẫn lúc xem không sinh database rỗng gây nhầm lẫn."""
        self.assertEqual(self.command("list")[0], 1)
        self.assertFalse(self.database.exists())

    def test_delete_other_tenant_does_not_remove_mapping(self):
        """UUID cùng tên không đủ để xóa nhầm tenant."""
        self.add()
        self.assertEqual(self.command("delete", "--tenant", "other-tenant", "--user-uuid", "user-1")[0], 1)
        self.assertEqual(len(json.loads(self.command("list")[1])["items"]), 1)


if __name__ == "__main__":
    unittest.main()
