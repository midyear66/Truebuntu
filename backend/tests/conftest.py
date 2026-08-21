import os
import sys

# Make "backend.*" importable when pytest is run from anywhere in the repo.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# backend.utils.auth refuses to import without a secret, and several modules
# pull it in transitively via backend.database's v9 migration.
os.environ.setdefault("SECRET_KEY", "test-secret-not-used-outside-the-test-suite")
