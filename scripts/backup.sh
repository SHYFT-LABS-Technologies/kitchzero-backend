#!/bin/bash

BACKUP_DIR="/var/backups/kitchzero"
DATE=$(date +"%Y%m%d_%H%M%S")

# Create backup directory
mkdir -p $BACKUP_DIR

# Database backup
docker exec kitchzero-postgres-prod pg_dump -U $DB_USERNAME $DB_NAME | gzip > $BACKUP_DIR/db_backup_$DATE.sql.gz

# Redis backup
docker exec kitchzero-redis-prod redis-cli -a $REDIS_PASSWORD --rdb /data/dump_$DATE.rdb
docker cp kitchzero-redis-prod:/data/dump_$DATE.rdb $BACKUP_DIR/

# Application logs backup
tar -czf $BACKUP_DIR/logs_backup_$DATE.tar.gz /var/log/kitchzero/

# Clean old backups (keep last 30 days)
find $BACKUP_DIR -name "*backup*" -mtime +30 -delete

echo "✅ Backup completed: $BACKUP_DIR"