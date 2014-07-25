// global
var myMask = null;
var app = null;

// app
Ext.define('CustomApp', {
    scopeType: 'release',
    extend: 'Rally.app.App',
    componentCls: 'app',

    launch: function() {
        // console.log("launch 2");
        // get the project id.
        this.project = this.getContext().getProject().ObjectID;
        app = this;
        var that = this;
        // get the release (if on a page scoped to the release)
        var tbName = getReleaseTimeBox(this);
        
        this.rows = [];
        this.customColumns = [
            {name:"CreationDate",type:"Date"},
            {name:"LastUpdateDate",type:"Date"}
        ];

        var configs = [];
        
        configs.push({ model : "PreliminaryEstimate", 
                       fetch : ['Name','ObjectID','Value'], 
                       filters : [] 
        });
        configs.push({ model : "Project",             
                       fetch : ['Name','ObjectID'], 
                       filters : [] 
        });
        configs.push({ model : "Release",             
                       fetch : ['Name', 'ObjectID', 'Project', 'ReleaseStartDate', 'ReleaseDate' ], 
                       filters:[] 
        });
        configs.push({ model : "Iteration",             
                       fetch : ['Name', 'ObjectID', 'Project', 'StartDate', 'EndDate' ], 
                       filters:[] 
        });
        // lowest level pi type
        configs.push({ model : "TypeDefinition",
                       fetch : true,
                       filters : [ { property:"Ordinal", operator:"=", value:0} ]
        });

        
        async.map( configs, this.wsapiQuery, function(err,results) {
            // console.log("results",results);
            that.peRecords = results[0];
            that.projects  = results[1];
            that.releases  = results[2];
            that.iterations = results[3];
            that.featureType = results[4][0].get("TypePath");
            that.createReleaseCombo(that.releases);
        });
    },
    
    wsapiQuery : function( config , callback ) {
        Ext.create('Rally.data.WsapiDataStore', {
            autoLoad : true,
            limit : "Infinity",
            model : config.model,
            fetch : config.fetch,
            filters : config.filters,
            sorters : config.sorters,
            listeners : {
                scope : this,
                load : function(store, data) {
                    callback(null,data);
                }
            }
        });
    },
    
    // creates a release drop down combo box with the uniq set of release names
    createReleaseCombo : function(releaseRecords) {
        
        // given a list of all releases (accross sub projects)
        var releases = _.map( releaseRecords, function(rec) { return { name : rec.get("Name"), objectid : rec.get("ObjectID"), releaseDate : new Date(Date.parse(rec.get("ReleaseDate")))};});
        // get a unique list by name to display in combobox        
        releases = _.uniq( releases, function (r) { return r.name; });
        releases = _.sortBy( releases, function(rec) {return rec.releaseDate;}).reverse();
        // create a store with the set of unique releases
        var releasesStore = Ext.create('Ext.data.Store', {
            fields: ['name','objectid'], data : releases 
        });
        // construct the combo box using the store
        var cb = Ext.create("Ext.ux.CheckCombo", {
            itemId : 'comboRelease',
            fieldLabel: 'Release',
            store: releasesStore,
            queryMode: 'local',
            displayField: 'name',
            valueField: 'name',
            noData : true,
            width: 300,
                
            listeners : {
                scope : this,
                // after collapsing the list
                collapse : function ( field, eOpts ) {
                        this.queryFeatures(releases);
                }
            }
        });
        // this.add(cb);
        
        var cbCompleted = Ext.create("Rally.ui.CheckboxField", {
            fieldLabel : "Hide Completed",
            itemId : "cbCompleted",
            value  : true,    
            listeners : {
                scope : this,
                change : function() {
                    this.queryFeatures(releases);
                }
            }
        });
        
        var container = Ext.create('Ext.container.Container', {
            layout: {
                type: 'hbox',
                align : 'stretch',
                defaultMargins : { top: 5, right: 20, bottom: 0, left: 5 }
            }
        });
        
        container.add(cb);
        container.add(cbCompleted);
        this.add(container);
    },
    
    queryFeatures : function(releases) {
        // get Features for the selected release(s)
        var comboRelease = this.down("#comboRelease");
        var cbCompleted = this.down("#cbCompleted");
        var that = this;
        this.rows = [];

        if (comboRelease.getValue()==="") {
            return;
        }

        var selectedR = [];
        // // for each selected release name, select all releases with that name and grab the object id and push it into an 
        // // array. The result will be an array of all matching release that we will use to query for snapshots.
        _.each( comboRelease.getValue().split(","), function (rn) {
            var matching_releases = _.filter( releases, function(r) { return rn == r.name;});
            var uniq_releases = _.uniq(matching_releases, function(r) { return r.name; });
            _.each(uniq_releases,function(release) { selectedR.push(release); });
        });

        if (selectedR.length > 0) {
            myMask = new Ext.LoadMask(Ext.getBody(), {msg:"Please wait..."});
            myMask.show();
        } else {
            return;
        }

        var filter = null;
        var compFilter = null;
        _.each(selectedR,function(release,i) {
            var f = Ext.create('Rally.data.QueryFilter', {
                property: 'Release.Name',
                operator: '=',
                value: release.name
            });
            filter = i === 0 ? f : filter.or(f);
        });
        
        // add filter for completed
        if (cbCompleted.getValue()===true) {
            filter = filter.and (Ext.create('Rally.data.QueryFilter', {
                property: 'PercentDoneByStoryPlanEstimate',
                operator: '<',
                value: 1
            }));
        }
        
        var fetch = ['ObjectID','FormattedID','Name','LeafStoryCount','AcceptedLeafStoryCount','LeafStoryPlanEstimateTotal','AcceptedLeafStoryPlanEstimateTotal','PercentDoneByStoryCount',"Release","Rank" ];
        fetch = fetch.concat(_.pluck(app.customColumns,"name"));
        // console.log("fetch",fetch);
        
        var config = { 
            // model  : "PortfolioItem/Feature",
            model : that.featureType,
            fetch  : fetch,
            filters: [filter],
            sorters: [{ property: 'Rank', direction: 'ASC'}]
        };
        
        async.map([config], this.wsapiQuery, function(err,results) {
            myMask.hide();
            console.log("# of features in chart:",results[0].length);
            that.createTable(results[0]);
        });
    },
    
    addCustomFields : function(fields) {
        
        _.each(app.customColumns,function(col) {
            fields.push({
               name : col.name,
               type : col.type
            });
        });
        
    },
    
    addCustomColumns : function(columns) {

        _.each(app.customColumns,function(col) {
            var c = {
                header : col.name,   
                dataIndex : col.name, 
                width : 75,
                hidden : true,
                renderer : app.renderCustomColumn
            };
            columns.push(c);
        });

    },
    
    renderCustomColumn : function(value,meta,rec,row,col) {
        // console.log("v",value,"rec",rec,"col",app.columns[col].header);
        var h = app.columns[col].header;
        var v = rec.raw[h];
        if (h.indexOf("Date")!=-1)
            return Ext.Date.format(v,'m/d/Y');
        else
            return v;
    },

    
    addCustomValues : function( row, feature ) {
        
        _.each(app.customColumns,function(col) {
            row[col.name] = feature.get(col.name);
        });
        
    },
    
    addGrid : function() {
        
        var that = this;
        var height = 500;
        
        // create the store.
        // this.store = Ext.create('Ext.data.Store', {
        this.store = Ext.create('Rally.data.custom.Store', {
            fields: [
                    { name : "ID" ,     type : "string"},
                    { name : "Name" ,   type : "string"},
                    { name : "Release", type : "string"},
                    { name : "PlannedEndDate", type : "date"},
                    { name : "LastIterationDate", type : "date"},
                    { name : "Notes", type : "string"},
                    { name : "Progress"}
            ],
            data : this.rows
        });
        
        this.columns = [
            { header : 'ID',        dataIndex: 'ID', width : 50, align : "center", locked:true, renderer : this.renderLink },
            { header : "Name",      dataIndex : "Name", width : 300,locked:true      },
            { header : "Release",   dataIndex : "Release", width : 100,locked:true      },
            { header : "Planned",   dataIndex : "PlannedEndDate", width : 75,locked:true, renderer : Ext.util.Format.dateRenderer('m/d/Y') },
            { header : "Last Iteration",   dataIndex : "LastIterationDate", width : 75,locked:true, renderer : Ext.util.Format.dateRenderer('m/d/Y') },
            { header : "Notes",   dataIndex : "Notes", width : 100,locked:true      },
            { header : "Progress",  align : "center", renderer : this.renderProgress, width : 100,locked:true} 
        ];
        
        this.addCustomColumns(this.columns);
        // console.log("cols",this.columns);
        
        var g = app.down("#mygrid");
        if (g) {
            g.destroy();
        }
        
        // this.grid = Ext.create('Ext.grid.Panel', {
        this.grid = Ext.create('Rally.ui.grid.Grid', {
            id : 'mygrid',
            // itemId : 'mygrid',
            store: this.store,
            columnsCfgs : this.columns,
            viewConfig: {
                stripeRows: true
            },
            columnLines: true,
            listeners: {
                afterrender: function(grid) {
                    // grid.setHeight(that.getHeight()-20);
                },
                columnshow : function( ct, column, eOpts ) {
                    // console.log("grid",app.grid);
                    app.store.load();
                    //app.store.load();
                    //app.grid.refresh();
                    //app.grid.reconfigure(null,app.columns);
                }
            }
        });
        this.add(this.grid);    
    },
    
    // maps the set of story snapshots for each feature
    mapSnapshots : function( features ) {
    
        async.map(features, this.readFeatureSnapshots, function(err,results) {
            
        });
        
    },
    
     // read all stories for a specific feature.
    readFeatureSnapshots : function(feature,callback) {
        var that = this;

        var row = { 
            ID : feature.get("FormattedID"),
            ref : feature.get("_ref"),
            Name : feature.get("Name"),
            Notes : feature.get("Notes"),
            Release : feature.get("Release")._refObjectName,
            PlannedEndDate : feature.get("PlannedEndDate"),
            Progress : { progress : p, total : featureTotal, accepted : featureAcceptedTotal },
            Rank : feature.get("Rank")
        };
        
        app.addCustomValues(row,feature);
        // console.log("row",row);
        
        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            listeners: {
                scope : this,
                load: function(store, data, success) {
                    var children = _.filter( data, function (d) { return d.get("Children").length === 0;});
                    row.LastIterationDate = app.lastIterationDate(children);
                    var grouped = _.groupBy( children, function(child) { return child.get("Project");});
                    _.each( _.keys(grouped), function(key) {
                        var stories  = grouped[key];
                        var total    = _.reduce( stories, function(memo,child) {return memo + child.get("PlanEstimate");},0);
                        var accepted = _.reduce( stories, function(memo,child) {return memo + ( child.get("ScheduleState")=="Accepted" ? child.get("PlanEstimate") :0);},0);
                        var p        = total > 0 ? (accepted/total) * 100 : 0;
                        row.Teams = _.isUndefined(row.Teams) ? {} : row.Teams;
                        // row["Teams"][key] = p;
                        row.Teams[key] = {progress:p,total:total,accepted:accepted};
                    });
                    app.rows.push(row);

                    callback(null,row);
                }
            },
            fetch: ['Project', 'ScheduleState', 'PlanEstimate','Children','Iteration'],
            hydrate : ['ScheduleState'],
            filters: [
                {
                    property: '_TypeHierarchy',
                    operator: 'in',
                    value: ['HierarchicalRequirement']
                },
                {
                    property: '_ItemHierarchy',
                    operator: 'in',
                    value: [feature.get("ObjectID")]
                },
                {
                    property: '__At',
                    operator: '=',
                    value: 'current'
                }
            ]
        });
    },
    
    createTable : function(features) {

        this.addGrid();
        async.map(features, this.readFeature, function(err,results) {
            // extract the team values
            var tValues = _.compact(_.pluck(results,"Teams"));
            // flatten to a list of project id's
            var pOids = [];
            _.each(tValues,function(t){
               pOids = pOids.concat(_.keys(t));
            });
            // group by project (to get the count per project)
            var groupedP = _.groupBy(pOids,function(p) {return p;});
            // sort by number of teams
            var sortedP = _.sortBy( _.keys(groupedP), function(p) { return groupedP[p].length;}).reverse();

            _.each( sortedP, function(p) {
                app.columns.push({  
                    text: p, 
                    header: app.projectName(p), 
                    // dataIndex: p, 
                    flex: 1, 
                    width : 120, 
                    align : 'center', 
                    renderer : app.renderPercentDone });
            });
            app.grid.reconfigure(null,app.columns);
            app.store.load();
        });
    },
    
    projectName : function(pid) {
        var project = _.find(this.projects,function(p) { return p.get("ObjectID") == pid; });
        return project ? project.get("Name") : null;
    },
    
    renderLink : function(value,meta,rec,row,col) {
        return value;
        // return ("<a ref=\""+Rally.util.Ref.getUrl(rec.raw.ref)+">"+rec.get("FormattedID")+"</a>");
    },
    
    renderProgress : function(value,meta,rec,row,col) {
        return app.renderValue(rec.get("Progress"));
    },
    
    renderPercentDone : function(value,meta,rec,row,col) {
        // if (_.isUndefined(value))
        //     return "";
        // var p = app.columns[3+col].text;
        var p = app.columns[col].text;
        return (_.isUndefined(rec.raw.Teams) || _.isUndefined(rec.raw.Teams[p])) ? "" : app.renderValue( rec.raw.Teams[p]);
    },
    
    renderValue : function(v) {
        var id = Ext.id();
        Ext.defer(function () {
            Ext.widget('progressbar', {
                text : "" + Math.round(v.progress) + "%" + " (" + v.accepted + "/"+ v.total + ")" ,
                renderTo: id,
                value: v.progress / 100
            });
        }, 50);
        return Ext.String.format('<div id="{0}"></div>', id);
    },
    
    iterationFromId : function (id) {
        var iteration = _.find( app.iterations, function(i) {
            return i.get("ObjectID") === id;
        });
        
        return iteration;
    },
    
    // returns the latest iteration by date stories are scheduled into
    lastIterationDate : function(stories) {
        
        var iEndDates = _.map(stories, function(story) {
            var it = story.get("Iteration");
            if ( !_.isUndefined(it) && !_.isNull(it) ) {
                var iteration = app.iterationFromId(it);
                if (!_.isUndefined(iteration) && !_.isNull(iteration)) {
                    return iteration.get("EndDate");
                }
            }
        });
        iEndDates = _.compact(iEndDates);
        
        return iEndDates.length === 0 ? null : _.last( _.sortBy(iEndDates));
    },
    
    // read all stories for a specific feature.
    readFeature : function(feature,callback) {
        var that = this;
        var featureTotal = feature.get("LeafStoryPlanEstimateTotal");
        var featureAcceptedTotal = feature.get("AcceptedLeafStoryPlanEstimateTotal");
        // var p = feature.get("LeafStoryPlanEstimateTotal") > 0 ?
        //     (feature.get("AcceptedLeafStoryPlanEstimateTotal") / feature.get("LeafStoryPlanEstimateTotal"))*100 : 0;
        var p = featureTotal > 0 ? (featureAcceptedTotal / featureTotal)*100 : 0;
        
        var row = { 
            ID : feature.get("FormattedID"),
            ref : feature.get("_ref"),
            Name : feature.get("Name"),
            Notes : feature.get("Notes"),
            Release : feature.get("Release")._refObjectName,
            PlannedEndDate : feature.get("PlannedEndDate"),
            Progress : { progress : p, total : featureTotal, accepted : featureAcceptedTotal },
            Rank : feature.get("Rank")
        };
        
        app.addCustomValues(row,feature);
        // console.log("row",row);
        
        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            listeners: {
                scope : this,
                load: function(store, data, success) {
                    var children = _.filter( data, function (d) { return d.get("Children").length === 0;});
                    row.LastIterationDate = app.lastIterationDate(children);
                    var grouped = _.groupBy( children, function(child) { return child.get("Project");});
                    _.each( _.keys(grouped), function(key) {
                        var stories  = grouped[key];
                        var total    = _.reduce( stories, function(memo,child) {return memo + child.get("PlanEstimate");},0);
                        var accepted = _.reduce( stories, function(memo,child) {return memo + ( child.get("ScheduleState")=="Accepted" ? child.get("PlanEstimate") :0);},0);
                        var p        = total > 0 ? (accepted/total) * 100 : 0;
                        row.Teams = _.isUndefined(row.Teams) ? {} : row.Teams;
                        // row["Teams"][key] = p;
                        row.Teams[key] = {progress:p,total:total,accepted:accepted};
                    });
                    app.rows.push(row);

                    callback(null,row);
                }
            },
            fetch: ['Project', 'ScheduleState', 'PlanEstimate','Children','Iteration'],
            hydrate : ['ScheduleState'],
            filters: [
                {
                    property: '_TypeHierarchy',
                    operator: 'in',
                    value: ['HierarchicalRequirement']
                },
                {
                    property: '_ItemHierarchy',
                    operator: 'in',
                    value: [feature.get("ObjectID")]
                },
                {
                    property: '__At',
                    operator: '=',
                    value: 'current'
                }
            ]
        });
    }
});
