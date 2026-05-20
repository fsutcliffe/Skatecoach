#!/usr/bin/env bash
# Start the Sideline Jump Analysis Server
set -e

cd "$(dirname "$0")"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install/upgrade dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Start the server
echo "Starting Sideline server on http://0.0.0.0:8000..."
python main.py
